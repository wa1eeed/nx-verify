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

export function hashContent(content: EvidenceContent): Buffer {
  return createHash('sha256').update(canonicalJson(content), 'utf8').digest();
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

export async function sealEvidence(
  tx: TenantTransaction,
  input: SealEvidenceInput,
): Promise<SealedEvidence> {
  const contentHash = hashContent(input.content);
  const signature = signContent(input.signingKey, contentHash);
  // Long enough that it cannot be guessed, and carrying no information about the subject.
  const publicToken = randomBytes(24).toString('base64url');

  const keyVersion = input.keyVersion ?? 1;

  const { rows } = await tx.query<{ id: string; signed_at: Date }>(
    `INSERT INTO evidence (tenant_id, run_id, storage_key, content_hash, signature,
                           public_token, expires_at, key_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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

export interface PublicEvidence {
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
  }>('SELECT content_hash, signed_at, expires_at FROM app.resolve_evidence_token($1)', [token]);

  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    contentHash: row.content_hash.toString('hex'),
    signedAt: row.signed_at,
    expiresAt: row.expires_at,
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
    'SELECT storage_key FROM evidence WHERE tenant_id = $1 AND run_id = $2',
    [tx.tenantId, runId],
  );
  return rows[0]?.storage_key ?? null;
}

/** Confirms a document still matches what was sealed. */
/**
 * Confirms a document still matches what was sealed.
 *
 * The key is supplied by the caller, which must ask for the version this row recorded.
 * `evidenceKeyVersion` below is how a caller learns which one that is, so a seal made
 * before a rotation keeps verifying after it.
 */
export async function checkEvidence(
  tx: TenantTransaction,
  evidenceId: string,
  content: EvidenceContent,
  signingKey: Buffer,
): Promise<{ hashMatches: boolean; signatureValid: boolean }> {
  const { rows } = await tx.query<{ content_hash: Buffer; signature: Buffer }>(
    `SELECT content_hash, signature FROM evidence WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, evidenceId],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', { detail: 'no such evidence' });
  }

  const recomputed = hashContent(content);
  return {
    hashMatches: recomputed.equals(row.content_hash),
    signatureValid: verifySignature(signingKey, row.content_hash, row.signature),
  };
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

export function hashBundle(content: BundleContent): Buffer {
  return createHash('sha256').update(canonicalJson(content), 'utf8').digest();
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

  const contentHash = hashBundle(content);
  const signature = signContent(input.signingKey, contentHash);
  const publicToken = randomBytes(24).toString('base64url');

  const keyVersion = input.keyVersion ?? 1;

  const { rows } = await tx.query<{ id: string; signed_at: Date }>(
    `INSERT INTO evidence (tenant_id, run_id, storage_key, content_hash, signature,
                           public_token, expires_at, key_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, signed_at`,
    [
      tx.tenantId,
      input.runId,
      `evidence/${tx.tenantId}/bundles/${input.portfolioId}.pdf`,
      contentHash,
      signature,
      publicToken,
      input.expiresAt ?? null,
      keyVersion,
    ],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-5001', { detail: 'bundle insert returned no id' });
  }

  return {
    evidenceId: row.id,
    contentHash: contentHash.toString('hex'),
    publicToken,
    signedAt: row.signed_at,
    keyVersion,
    entityCount: content.entityCount,
    fieldCount: content.fieldCount,
  };
}
