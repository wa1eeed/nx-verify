import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { canonicalJson } from '../canonical-json.js';

/**
 * The evidence file.
 *
 * What makes this worth anything is not the document, it is that the document can be
 * checked later by someone who does not have an account here. So the record holds a hash
 * of the sealed content and a signature over it, and the public token opens a page
 * showing the hash and the sealing time.
 *
 * That page shows nothing else. No name, no identifier, no field values. A public
 * verification page that leaks personal data is worse than having none, and the token is
 * printed on a document that will be forwarded to people we never see.
 */

export interface EvidenceContent {
  runId: string;
  productCode: string;
  status: string;
  decision: string | null;
  entityId: string | null;
  /** Field summaries. Each carries its authority and its timestamp, as everything does. */
  fields: { fieldPath: string; authority: string | null; observedAt: string }[];
  sealedAt: string;
}

/**
 * One hash for everything we seal.
 *
 * A single run, a portfolio and a composite file are three shapes of the same promise, and
 * two hashing routines would eventually disagree about whitespace or key order and make a
 * document that is intact look altered.
 */
function hashOf(content: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(content), 'utf8').digest();
}

export function hashContent(content: EvidenceContent): Buffer {
  return hashOf(content);
}

export function signContent(signingKey: Buffer, contentHash: Buffer): Buffer {
  return createHmac('sha256', signingKey).update(contentHash).digest();
}

export function verifySignature(
  signingKey: Buffer,
  contentHash: Buffer,
  signature: Buffer,
): boolean {
  const expected = signContent(signingKey, contentHash);
  return expected.length === signature.length && timingSafeEqual(expected, signature);
}

export interface SealEvidenceInput {
  runId: string;
  content: EvidenceContent;
  storageKey: string;
  signingKey: Buffer;
  /** The version that produced the signing key. Recorded so it stays verifiable. */
  keyVersion?: number;
  /** How long the public page stays available. Null means indefinitely. */
  expiresAt?: Date | null;
}

export interface SealedEvidence {
  evidenceId: string;
  contentHash: string;
  publicToken: string;
  signedAt: Date;
  /**
   * Which key version signed this seal.
   *
   * Never rewritten. Re-keying an identifier changes how a value is stored; re-signing
   * evidence would change a seal a customer has already handed to an auditor, and the
   * hash on their printed copy would stop matching ours.
   */
  keyVersion: number;
}

/**
 * The one INSERT behind every seal.
 *
 * `signed_at` is the content's own sealing time rather than the moment of the insert. The
 * document prints `sealedAt` from the content and the public page prints `signed_at` from
 * this row, and a holder comparing the two found them a few milliseconds apart with no way
 * to tell which one we meant.
 */
async function insertSeal(
  tx: TenantTransaction,
  input: {
    runId: string;
    storageKey: string;
    content: SealedContent;
    signingKey: Buffer;
    keyVersion?: number | undefined;
    expiresAt?: Date | null | undefined;
  },
): Promise<SealedEvidence> {
  const contentHash = hashOf(input.content);
  const signature = signContent(input.signingKey, contentHash);
  // Long enough that it cannot be guessed, and carrying no information about the subject.
  const publicToken = randomBytes(24).toString('base64url');
  const keyVersion = input.keyVersion ?? 1;

  const sealedAt = new Date(input.content.sealedAt);
  if (Number.isNaN(sealedAt.getTime())) {
    throw new NxError('NX-4002', { detail: 'the content carries no sealing time' });
  }

  const { rows } = await tx.query<{ id: string; signed_at: Date }>(
    `INSERT INTO evidence (tenant_id, run_id, storage_key, content_hash, signature,
                           public_token, expires_at, key_version, signed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, signed_at`,
    [
      tx.tenantId,
      input.runId,
      input.storageKey,
      contentHash,
      signature,
      publicToken,
      input.expiresAt ?? null,
      keyVersion,
      sealedAt,
    ],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-5001', { detail: 'evidence insert returned no id' });
  }

  return {
    evidenceId: row.id,
    contentHash: contentHash.toString('hex'),
    publicToken,
    signedAt: row.signed_at,
    keyVersion,
  };
}

export async function sealEvidence(
  tx: TenantTransaction,
  input: SealEvidenceInput,
): Promise<SealedEvidence> {
  return insertSeal(tx, {
    runId: input.runId,
    storageKey: input.storageKey,
    content: input.content,
    signingKey: input.signingKey,
    keyVersion: input.keyVersion,
    expiresAt: input.expiresAt,
  });
}

export interface PublicEvidence {
  /** True when the seal was made in a sandbox and proves nothing about anybody. */
  sandbox: boolean;
  contentHash: string;
  signedAt: Date;
  expiresAt: Date | null;
}

/**
 * The public check behind the QR code.
 *
 * Deliberately returns three values and cannot return more: the function it calls selects
 * three columns. Someone holding a printed document can confirm that this hash was sealed
 * by us at this time, and learns nothing about whom it concerns.
 */
export async function resolvePublicEvidence(
  db: Queryable,
  token: string,
): Promise<PublicEvidence | null> {
  const { rows } = await db.query<{
    content_hash: Buffer;
    signed_at: Date;
    expires_at: Date | null;
    sandbox: boolean;
  }>('SELECT content_hash, signed_at, expires_at, sandbox FROM app.resolve_evidence_token($1)', [
    token,
  ]);

  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    contentHash: row.content_hash.toString('hex'),
    signedAt: row.signed_at,
    expiresAt: row.expires_at,
    // Said out loud. Whoever holds a printed document has no account here and no other
    // way to learn that what they are looking at was a test.
    sandbox: row.sandbox,
  };
}

/**
 * Where the rendered document for a run was written.
 *
 * Tenant scoped, so the storage key of one subscriber's document is unreachable from
 * another's session even before the store is asked for the file.
 */
export async function evidenceStorageKey(
  tx: TenantTransaction,
  runId: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ storage_key: string }>(
    // A bundle is sealed against one of the runs it covers, so a run can carry two seals:
    // its own document and a bundle that has none. Without this a document route would
    // sometimes answer with the bundle's marker and report a missing file for a document
    // that exists.
    `SELECT storage_key FROM evidence
     WHERE tenant_id = $1 AND run_id = $2 AND storage_key NOT LIKE $3
     ORDER BY signed_at DESC
     LIMIT 1`,
    [tx.tenantId, runId, `${BUNDLE_KEY_PREFIX}%`],
  );
  return rows[0]?.storage_key ?? null;
}

/**
 * What can be handed back to us for checking.
 *
 * The content when the caller still holds it, and otherwise the fingerprint printed on the
 * document. Someone walking in with a sealed page has the fingerprint and nothing else:
 * a check that only accepted the canonical content would have no caller outside our own
 * tests, which is exactly where it sat.
 */
export type EvidenceClaim = SealedContent | { contentHash: string };

const HEX_HASH = /^[0-9a-f]{64}$/i;

/**
 * Confirms a document still matches what was sealed.
 *
 * The key is supplied by the caller, which must ask for the version this row recorded.
 * `evidenceKeyVersion` below is how a caller learns which one that is, so a seal made
 * before a rotation keeps verifying after it.
 *
 * The two answers are separate on purpose. `signatureValid` says the seal in our own
 * record has not been altered; `hashMatches` says the paper in front of the reader is the
 * thing we sealed. A screen that merged them into one tick would tell a subscriber their
 * document is genuine when all we checked was our own row against itself.
 */
export async function checkEvidence(
  tx: TenantTransaction,
  evidenceId: string,
  claim: EvidenceClaim,
  signingKey: Buffer,
): Promise<{ hashMatches: boolean; signatureValid: boolean }> {
  const claimed = claimedHash(claim);

  const { rows } = await tx.query<{ content_hash: Buffer; signature: Buffer }>(
    `SELECT content_hash, signature FROM evidence WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, evidenceId],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', { detail: 'no such evidence' });
  }

  return {
    hashMatches: claimed.equals(row.content_hash),
    signatureValid: verifySignature(signingKey, row.content_hash, row.signature),
  };
}

function claimedHash(claim: EvidenceClaim): Buffer {
  if (!('contentHash' in claim)) {
    return hashOf(claim);
  }
  // Buffer.from silently drops what is not hexadecimal, so a typed fingerprint missing a
  // character would become a short buffer that matches nothing and read as a forgery.
  if (!HEX_HASH.test(claim.contentHash)) {
    throw new NxError('NX-4002', { detail: 'the fingerprint is not 64 hexadecimal characters' });
  }
  return Buffer.from(claim.contentHash, 'hex');
}

/** Which key version signed a seal, so the right one can be asked for to verify it. */
export async function evidenceKeyVersion(
  tx: TenantTransaction,
  evidenceId: string,
): Promise<number> {
  const { rows } = await tx.query<{ key_version: number }>(
    `SELECT key_version FROM evidence WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, evidenceId],
  );
  const version = rows[0]?.key_version;
  if (version === undefined) {
    throw new NxError('NX-4041', { detail: 'no such evidence' });
  }
  return version;
}

/** Builds the sealed content from a completed run. */
export async function buildEvidenceContent(
  tx: TenantTransaction,
  runId: string,
): Promise<EvidenceContent> {
  const { rows } = await tx.query<{
    id: string;
    product_code: string;
    status: string;
    decision: string | null;
    entity_id: string | null;
  }>(
    `SELECT id, product_code, status, decision, entity_id
     FROM verification_runs WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, runId],
  );

  const run = rows[0];
  if (!run) {
    throw new NxError('NX-4041', { detail: 'no such run' });
  }

  const { rows: fields } = await tx.query<{
    field_path: string;
    authority: string | null;
    observed_at: Date;
  }>(
    `SELECT field_path, authority, observed_at
     FROM attestations
     WHERE tenant_id = $1 AND run_id = $2
     ORDER BY field_path`,
    [tx.tenantId, runId],
  );

  return {
    runId: run.id,
    productCode: run.product_code,
    status: run.status,
    decision: run.decision,
    entityId: run.entity_id,
    // Rule 5: the provider is not among these. The authority is.
    fields: fields.map((field) => ({
      fieldPath: field.field_path,
      authority: field.authority,
      observedAt: field.observed_at.toISOString(),
    })),
    sealedAt: new Date().toISOString(),
  };
}

/**
 * A bundle covering many entities at once.
 *
 * docs/01-blueprint.md section 5.8: one file for a whole portfolio when an auditor asks.
 * A single button that saves a week of assembling folders, and the reason it is worth
 * anything is that it is sealed exactly like a single document: one hash, one signature,
 * one public page confirming both.
 *
 * The bundle lists what was verified, by which authority and when. It does not list who
 * the entities are: the identifiers stay where they are (rule 4), and an auditor checking
 * a seal does not need them.
 */
export interface BundleEntry {
  entityId: string;
  fields: { fieldPath: string; authority: string | null; observedAt: string; freshness: string }[];
}

export interface BundleContent {
  kind: 'portfolio-bundle';
  portfolioId: string;
  entities: BundleEntry[];
  entityCount: number;
  fieldCount: number;
  sealedAt: string;
}

/** Everything this module knows how to seal. Each carries the moment it was sealed. */
export type SealedContent = EvidenceContent | BundleContent | CaseBundleContent;

export function hashBundle(content: BundleContent | CaseBundleContent): Buffer {
  return hashOf(content);
}

/**
 * What a bundle's storage key says.
 *
 * A bundle has no rendered file: nothing writes one, and a key shaped like a path would
 * claim a document that the document route would then fail to fetch. So the key says what
 * the seal covers and, by not being a path, that there is nothing stored to serve. The
 * subject belongs in a column of its own; until the schema has one this marker is how a
 * bundle is found again, which is why it is an exact string and not a pattern.
 */
const BUNDLE_KEY_PREFIX = 'bundle:';

function bundleKey(kind: 'case' | 'portfolio', id: string): string {
  return `${BUNDLE_KEY_PREFIX}${kind}/${id}`;
}

export async function buildBundleContent(
  tx: TenantTransaction,
  portfolioId: string,
): Promise<BundleContent> {
  const { rows } = await tx.query<{
    entity_id: string;
    field_path: string;
    authority: string | null;
    observed_at: Date;
    freshness: string;
  }>(
    `SELECT p.entity_id, p.field_path, p.authority, p.observed_at, p.freshness
     FROM entity_profile p
     JOIN portfolio_members m
       ON m.tenant_id = p.tenant_id AND m.entity_id = p.entity_id
     WHERE p.tenant_id = $1 AND m.portfolio_id = $2
     ORDER BY p.entity_id, p.field_path`,
    [tx.tenantId, portfolioId],
  );

  const byEntity = new Map<string, BundleEntry>();
  for (const row of rows) {
    const entry = byEntity.get(row.entity_id) ?? { entityId: row.entity_id, fields: [] };
    entry.fields.push({
      fieldPath: row.field_path,
      authority: row.authority,
      observedAt: row.observed_at.toISOString(),
      freshness: row.freshness,
    });
    byEntity.set(row.entity_id, entry);
  }

  const entities = [...byEntity.values()];
  return {
    kind: 'portfolio-bundle',
    portfolioId,
    entities,
    entityCount: entities.length,
    fieldCount: rows.length,
    sealedAt: new Date().toISOString(),
  };
}

export interface SealedBundle extends SealedEvidence {
  entityCount: number;
  fieldCount: number;
}

/**
 * Seals a bundle against a run, because evidence belongs to a verification in this
 * schema. The run supplied should be the one that produced the newest fact in the
 * bundle, which is what an auditor would ask for if they asked.
 */
export async function sealBundle(
  tx: TenantTransaction,
  input: {
    portfolioId: string;
    runId: string;
    signingKey: Buffer;
    keyVersion?: number;
    expiresAt?: Date | null;
  },
): Promise<SealedBundle> {
  const content = await buildBundleContent(tx, input.portfolioId);
  if (content.entityCount === 0) {
    throw new NxError('NX-4002', { detail: 'this portfolio has nothing to seal' });
  }

  const sealed = await insertSeal(tx, {
    runId: input.runId,
    storageKey: bundleKey('portfolio', input.portfolioId),
    content,
    signingKey: input.signingKey,
    keyVersion: input.keyVersion,
    expiresAt: input.expiresAt,
  });

  return { ...sealed, entityCount: content.entityCount, fieldCount: content.fieldCount };
}

/**
 * The composite file's bundle: several verifications, one document, one signature.
 *
 * An onboarding file asks for four or five checks about the same applicant, and until now
 * each one was sealed on its own. Four seals are not evidence that the file was completed:
 * they are four facts a reader has to assemble, and nothing binds them to the file that
 * required them.
 *
 * The bundle names every step of the file, including the ones nobody ran. A document that
 * listed only what was verified would read as a clean file when a required check had been
 * waived, which is the one reading it must never allow.
 */
export interface CaseBundleStep {
  stepKey: string;
  productCode: string;
  required: boolean;
  status: string;
  /** Why a check was not run, from the closed set the console offers. */
  waiveReason: string | null;
  run: CaseBundleRun | null;
}

export interface CaseBundleRun {
  runId: string;
  /** The number a person reads out loud. */
  reference: string | null;
  status: string;
  decision: string | null;
  /** Rule 5: the authority, never the provider. Rule 6: never a field without its time. */
  fields: { fieldPath: string; authority: string | null; observedAt: string }[];
}

export interface CaseBundleContent {
  kind: 'case-bundle';
  caseId: string;
  reference: string;
  journeyCode: string;
  status: string;
  outcome: string | null;
  steps: CaseBundleStep[];
  runCount: number;
  fieldCount: number;
  sealedAt: string;
}

export async function buildCaseBundleContent(
  tx: TenantTransaction,
  caseId: string,
): Promise<CaseBundleContent> {
  const { rows: cases } = await tx.query<{
    reference: string;
    journey_code: string;
    status: string;
    outcome: string | null;
  }>(
    `SELECT reference, journey_code, status, outcome
     FROM onboarding_cases WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, caseId],
  );

  const onboarding = cases[0];
  if (!onboarding) {
    throw new NxError('NX-4041', { detail: 'no such onboarding case' });
  }

  const { rows: steps } = await tx.query<{
    step_key: string;
    product_code: string;
    required: boolean;
    status: string;
    waive_reason: string | null;
    run_id: string | null;
    run_reference: string | null;
    run_status: string | null;
    decision: string | null;
  }>(
    `SELECT s.step_key, s.product_code, s.required, s.status, s.waive_reason,
            s.run_id, r.reference AS run_reference, r.status AS run_status, r.decision
     FROM onboarding_case_steps s
     LEFT JOIN verification_runs r ON r.tenant_id = s.tenant_id AND r.id = s.run_id
     WHERE s.tenant_id = $1 AND s.case_id = $2
     ORDER BY s.seq`,
    [tx.tenantId, caseId],
  );

  const runIds = steps
    .map((step) => step.run_id)
    .filter((runId): runId is string => runId !== null);

  // One query for every run's facts rather than one per step: a file with ten checks
  // should not cost ten round trips to seal.
  const { rows: facts } = runIds.length
    ? await tx.query<{
        run_id: string;
        field_path: string;
        authority: string | null;
        observed_at: Date;
      }>(
        `SELECT run_id, field_path, authority, observed_at
         FROM attestations
         WHERE tenant_id = $1 AND run_id = ANY($2::uuid[])
         ORDER BY run_id, field_path`,
        [tx.tenantId, runIds],
      )
    : { rows: [] };

  const fieldsOf = new Map<string, CaseBundleRun['fields']>();
  for (const fact of facts) {
    const fields = fieldsOf.get(fact.run_id) ?? [];
    fields.push({
      fieldPath: fact.field_path,
      authority: fact.authority,
      observedAt: fact.observed_at.toISOString(),
    });
    fieldsOf.set(fact.run_id, fields);
  }

  const bundleSteps = steps.map((step): CaseBundleStep => {
    const runId = step.run_id;
    return {
      stepKey: step.step_key,
      productCode: step.product_code,
      required: step.required,
      status: step.status,
      waiveReason: step.waive_reason,
      run:
        runId === null
          ? null
          : {
              runId,
              reference: step.run_reference,
              status: step.run_status ?? 'UNKNOWN',
              decision: step.decision,
              fields: fieldsOf.get(runId) ?? [],
            },
    };
  });

  return {
    kind: 'case-bundle',
    caseId,
    reference: onboarding.reference,
    journeyCode: onboarding.journey_code,
    status: onboarding.status,
    outcome: onboarding.outcome,
    steps: bundleSteps,
    runCount: runIds.length,
    fieldCount: facts.length,
    sealedAt: new Date().toISOString(),
  };
}

export interface SealedCaseBundle extends SealedEvidence {
  runCount: number;
  fieldCount: number;
}

/**
 * Seals a composite file.
 *
 * Sealed against the newest run in the file, because evidence belongs to a verification in
 * this schema and that is the one an auditor would ask for. The file itself may still be
 * open: a bundle sealed today says what was true today, and its content names the file's
 * status so nobody reads a half finished file as a finished one.
 */
export async function sealCaseBundle(
  tx: TenantTransaction,
  input: {
    caseId: string;
    signingKey: Buffer;
    keyVersion?: number;
    expiresAt?: Date | null;
  },
): Promise<SealedCaseBundle> {
  const content = await buildCaseBundleContent(tx, input.caseId);
  if (content.runCount === 0) {
    throw new NxError('NX-4002', { detail: 'this file has no verification to seal yet' });
  }

  const { rows } = await tx.query<{ id: string }>(
    `SELECT r.id
     FROM onboarding_case_steps s
     JOIN verification_runs r ON r.tenant_id = s.tenant_id AND r.id = s.run_id
     WHERE s.tenant_id = $1 AND s.case_id = $2
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [tx.tenantId, input.caseId],
  );

  const runId = rows[0]?.id;
  if (runId === undefined) {
    throw new NxError('NX-4002', { detail: 'this file has no verification to seal yet' });
  }

  const sealed = await insertSeal(tx, {
    runId,
    storageKey: bundleKey('case', input.caseId),
    content,
    signingKey: input.signingKey,
    keyVersion: input.keyVersion,
    expiresAt: input.expiresAt,
  });

  return { ...sealed, runCount: content.runCount, fieldCount: content.fieldCount };
}

export interface SealRecord {
  evidenceId: string;
  contentHash: string;
  publicToken: string | null;
  signedAt: Date;
  expiresAt: Date | null;
  keyVersion: number;
  runId: string;
  runReference: string | null;
  /** True when this seal covers several runs rather than one. */
  bundle: boolean;
}

/** Every bundle sealed for one composite file, newest first. */
export async function listCaseSeals(
  tx: TenantTransaction,
  caseId: string,
): Promise<SealRecord[]> {
  const { rows } = await tx.query<SealRow>(
    `${SEAL_COLUMNS}
     WHERE e.tenant_id = $1 AND e.storage_key = $2
     ORDER BY e.signed_at DESC`,
    [tx.tenantId, bundleKey('case', caseId)],
  );
  return rows.map(sealRecord);
}

/**
 * The seal behind a reference somebody hands back to us.
 *
 * Tenant scoped, so a reference from another subscriber's document answers the same as a
 * reference we never issued: we do not hold it. Telling the two apart would say that some
 * other workspace has a document with this number, which is not this reader's business.
 */
export async function findSeal(
  tx: TenantTransaction,
  reference: string,
): Promise<SealRecord | null> {
  const trimmed = reference.trim();
  if (trimmed === '') {
    return null;
  }
  // A token is not a uuid, and comparing a token against a uuid column is an error rather
  // than a miss, so the id half of the question is only asked when it can be answered.
  const asUuid = UUID.test(trimmed) ? trimmed : null;

  const { rows } = await tx.query<SealRow>(
    `${SEAL_COLUMNS}
     WHERE e.tenant_id = $1 AND (e.public_token = $2 OR ($3::uuid IS NOT NULL AND e.id = $3::uuid))
     LIMIT 1`,
    [tx.tenantId, trimmed, asUuid],
  );

  const row = rows[0];
  return row ? sealRecord(row) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SealRow {
  id: string;
  content_hash: Buffer;
  public_token: string | null;
  signed_at: Date;
  expires_at: Date | null;
  key_version: number;
  run_id: string;
  run_reference: string | null;
  storage_key: string;
}

const SEAL_COLUMNS = `SELECT e.id, e.content_hash, e.public_token, e.signed_at, e.expires_at,
            e.key_version, e.run_id, e.storage_key, r.reference AS run_reference
     FROM evidence e
     JOIN verification_runs r ON r.tenant_id = e.tenant_id AND r.id = e.run_id`;

function sealRecord(row: SealRow): SealRecord {
  return {
    evidenceId: row.id,
    contentHash: row.content_hash.toString('hex'),
    publicToken: row.public_token,
    signedAt: row.signed_at,
    expiresAt: row.expires_at,
    keyVersion: row.key_version,
    runId: row.run_id,
    runReference: row.run_reference,
    bundle: row.storage_key.startsWith(BUNDLE_KEY_PREFIX),
  };
}
