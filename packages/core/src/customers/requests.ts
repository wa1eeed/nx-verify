import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import {
  decryptIdentifier,
  encryptIdentifier,
  hashIdentifier,
  maskIdentifier,
  type IdentifierType,
} from '../crypto/identifier.js';
import { findEntityIdByIdentifier } from '../repositories/identifiers.js';
import {
  certificateForCall,
  checksFor,
  listChecks,
  runChecks,
  settledPeople,
  type CheckDefinition,
  type CheckOutcome,
  type CustomerIdentity,
  type CustomerKind,
  type RunChecksDependencies,
} from './checks.js';
import { getCustomerFile } from './customer-file.js';
import { getPlatformSettings } from '../settings/platform.js';

/**
 * A verification request, and running it in the background (handoff screen 02).
 *
 * A subscriber ticks the checks for a customer and presses «تحقق من الكل», or presses the
 * button of one check, and the screen shows each row move from «قيد المعالجة» to its result
 * in whatever order they finish. Pressing must therefore return at once, and the checks must
 * be somewhere a second request can read while they run. That somewhere is a request row
 * and a row per check, and this file is everything that reads and moves them.
 *
 * What a request adds to runChecks, which does the calling:
 *
 *   - It is created under the key issued with the form, so a double click is one request
 *     and one set of charges (rule 7), and a draft is the same row not yet submitted.
 *   - It runs one check at a time, in the catalogue's order, claimed under a lock. The
 *     registry has to be read before the managers it names can be checked, and two
 *     runners must never take the same request at once.
 *   - A check that could not reach the authority is tried again, up to the attempts the
 *     platform allows, and a failed attempt costs nothing (guard 04). A check whose runner
 *     died mid-call is taken again under the same attempt, so a call that did finish is
 *     replayed rather than charged twice.
 *   - What was typed is sealed while it waits (rule 4), and dropped once the customer's
 *     file holds its own identifiers.
 */

export type RequestStatus = 'DRAFT' | 'QUEUED' | 'RUNNING' | 'DONE' | 'CANCELLED';
export type RequestCheckStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';
export type RequestOutcome =
  'OK' | 'PARTIAL' | 'NOT_FOUND' | 'ERROR' | 'SKIPPED' | 'REFUSED' | 'AWAITING';

/** What a person typed for a customer, before it is checked. */
export interface RequestSubject {
  /**
   * A company or an establishment: its unified number, or the registration number of one
   * already on file. A freelancer: the national or residence ID.
   */
  number?: string | undefined;
  /** A freelancer's certificate number. */
  certificateNumber?: string | undefined;
  iban?: string | undefined;
}

export type SubjectProblem = 'NUMBER' | 'REGISTRATION_UNKNOWN' | 'CERTIFICATE' | 'IBAN';

/** Why a subject was refused, in the words the screen shows. */
export const SUBJECT_PROBLEMS_AR: Readonly<Record<SubjectProblem, string>> = {
  NUMBER: 'تحقق من الرقم: الرقم الموحد عشرة أرقام يبدأ بـ7، والهوية عشرة أرقام تبدأ بـ1 أو 2.',
  REGISTRATION_UNKNOWN: 'لا يوجد ملف بهذا السجل. أدخل الرقم الموحد، ويبدأ بـ7، لإنشاء ملف جديد.',
  CERTIFICATE: 'رقم شهادة العمل الحر يبدأ بـFL- ثم ستة أرقام أو أكثر.',
  IBAN: 'الآيبان السعودي يبدأ بـSA ويتبعه 22 رقماً.',
};

const UNN = /^7[0-9]{9}$/;
const REGISTRATION = /^[1-6][0-9]{9}$/;
const PERSON_ID = /^[12][0-9]{9}$/;
const CERTIFICATE = /^FL-[0-9]{6,12}$/;
const IBAN = /^SA[0-9]{22}$/;

interface ParsedSubject {
  /** How the number is looked for on file. Null when nothing was typed. */
  idType: IdentifierType | null;
  number: string | null;
  certificate: string | null;
  iban: string | null;
}

/**
 * What was typed, cleaned and checked for shape.
 *
 * A problem is returned rather than thrown with the value in it: the value is an identifier,
 * and an identifier never reaches an error message (rule 4).
 */
export function parseSubject(
  kind: CustomerKind,
  subject: RequestSubject,
): { subject: ParsedSubject; problem: SubjectProblem | null } {
  const number = (subject.number ?? '').replace(/[\s-]/g, '');
  const certificate =
    subject.certificateNumber === undefined || subject.certificateNumber.trim() === ''
      ? null
      : certificateForCall(subject.certificateNumber);
  const iban = (subject.iban ?? '').replace(/[\s-]/g, '').toUpperCase();

  const parsed: ParsedSubject = {
    idType: null,
    number: number === '' ? null : number,
    certificate,
    iban: iban === '' ? null : iban,
  };

  if (parsed.number !== null) {
    if (kind === 'FREELANCER') {
      if (!PERSON_ID.test(parsed.number)) {
        return { subject: parsed, problem: 'NUMBER' };
      }
      parsed.idType = parsed.number.startsWith('2') ? 'IQAMA' : 'NATIONAL_ID';
    } else if (UNN.test(parsed.number)) {
      parsed.idType = 'UNN';
    } else if (REGISTRATION.test(parsed.number)) {
      parsed.idType = 'CR';
    } else {
      return { subject: parsed, problem: 'NUMBER' };
    }
  }
  if (parsed.certificate !== null && !CERTIFICATE.test(parsed.certificate)) {
    return { subject: parsed, problem: 'CERTIFICATE' };
  }
  if (parsed.iban !== null && !IBAN.test(parsed.iban)) {
    return { subject: parsed, problem: 'IBAN' };
  }
  return { subject: parsed, problem: null };
}

export interface CreateRequestInput {
  kind: CustomerKind;
  /** The customer, when the screen already found the file. */
  entityId?: string | null | undefined;
  subject: RequestSubject;
  productCodes: readonly string[];
  /** Issued with the form. The request and every call in it derive their keys from it. */
  bundleKey: string;
  requestedBy: string | null;
  /** Saved to run later, rather than run now. */
  draft?: boolean;
  /** Attempts a check gets when the authority cannot be reached. The platform's setting. */
  maxAttempts?: number;
  /** Check only these managers, pressed from their rows of the file. */
  onlyPeople?: readonly string[];
}

export interface CreatedRequest {
  requestId: string;
  status: RequestStatus;
  entityId: string | null;
  /** False when the key had already made this request: a double click, or a refresh. */
  created: boolean;
}

const BUNDLE = /^[A-Za-z0-9-]{8,60}$/;

async function requestByBundle(
  tx: TenantTransaction,
  bundleKey: string,
): Promise<CreatedRequest | null> {
  const { rows } = await tx.query<{ id: string; status: RequestStatus; entity_id: string | null }>(
    `SELECT id, status, entity_id FROM verification_requests
     WHERE tenant_id = $1 AND bundle_key = $2`,
    [tx.tenantId, bundleKey],
  );
  const row = rows[0];
  return row
    ? { requestId: row.id, status: row.status, entityId: row.entity_id, created: false }
    : null;
}

/** The checks of a request that this kind of customer is offered, deduplicated, in order. */
function offeredCodes(
  catalogue: readonly CheckDefinition[],
  kind: CustomerKind,
  productCodes: readonly string[],
): string[] {
  const wanted = new Set(productCodes);
  return checksFor(catalogue, kind)
    .filter((check) => wanted.has(check.productCode))
    .map((check) => check.productCode);
}

/** The attempts a check gets: what the caller says, or the platform's setting (screen 05). */
async function attemptsAllowed(tx: TenantTransaction, value: number | undefined): Promise<number> {
  const attempts = value ?? (await getPlatformSettings(tx)).maxAttempts;
  return Math.min(5, Math.max(1, Math.trunc(attempts)));
}

async function queueChecks(
  tx: TenantTransaction,
  requestId: string,
  productCodes: readonly string[],
  maxAttempts: number,
): Promise<void> {
  await tx.query(
    `INSERT INTO verification_request_checks (tenant_id, request_id, product_code, max_attempts)
     SELECT $1, $2, code, $4 FROM unnest($3::text[]) AS code
     ON CONFLICT DO NOTHING`,
    [tx.tenantId, requestId, [...productCodes], maxAttempts],
  );
}

export async function createRequest(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  input: CreateRequestInput,
): Promise<CreatedRequest> {
  if (!BUNDLE.test(input.bundleKey)) {
    throw new NxError('NX-4002', { detail: 'the request key is malformed' });
  }
  const existing = await requestByBundle(tx, input.bundleKey);
  if (existing) {
    return existing;
  }

  const productCodes = offeredCodes(await listChecks(tx), input.kind, input.productCodes);
  if (productCodes.length === 0) {
    throw new NxError('NX-4002', { detail: 'no check of this request applies to this customer' });
  }

  const { subject, problem } = parseSubject(input.kind, input.subject);
  if (problem !== null) {
    throw new NxError('NX-4002', { detail: `the subject is malformed: ${problem}` });
  }

  let entityId = input.entityId ?? null;
  if (entityId !== null) {
    const { rows } = await tx.query(`SELECT 1 FROM entities WHERE tenant_id = $1 AND id = $2`, [
      tx.tenantId,
      entityId,
    ]);
    if (rows.length === 0) {
      throw new NxError('NX-4041', { detail: 'customer not found' });
    }
  } else if (subject.number !== null && subject.idType !== null) {
    entityId = await findEntityIdByIdentifier(tx, keys, subject.idType, subject.number);
  }

  // A new customer is found at the authority by its unified number or its owner's ID. A
  // registration number only finds a customer who is already on file.
  if (entityId === null && (subject.number === null || subject.idType === 'CR')) {
    throw new NxError('NX-4002', { detail: 'a new customer needs a unified number or an ID' });
  }

  const version = await keys.currentVersion();
  const encryptionKey = await keys.encryptionKey(tx.tenantId, version);
  const hmacKey = await keys.hmacKey(tx.tenantId, version);
  // A customer on file carries its own identifiers. Only a new one needs what was typed.
  const sealSubject = entityId === null && subject.number !== null && subject.idType !== null;
  const draft = input.draft === true;

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO verification_requests
       (tenant_id, status, kind, entity_id, subject_type, subject_hash, subject_enc,
        certificate_enc, iban_enc, key_version, product_codes, bundle_key, requested_by,
        person_ids, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             CASE WHEN $2 = 'DRAFT' THEN NULL ELSE now() END)
     ON CONFLICT (tenant_id, bundle_key) DO NOTHING
     RETURNING id`,
    [
      tx.tenantId,
      draft ? 'DRAFT' : 'QUEUED',
      input.kind,
      entityId,
      sealSubject ? subject.idType : null,
      sealSubject
        ? hashIdentifier(hmacKey, subject.idType as IdentifierType, subject.number as string)
        : null,
      sealSubject
        ? encryptIdentifier(
            encryptionKey,
            subject.idType as IdentifierType,
            subject.number as string,
          )
        : null,
      subject.certificate === null
        ? null
        : encryptIdentifier(encryptionKey, 'FREELANCE_DOC', subject.certificate),
      subject.iban === null ? null : encryptIdentifier(encryptionKey, 'IBAN', subject.iban),
      version,
      productCodes,
      input.bundleKey,
      input.requestedBy,
      input.onlyPeople === undefined || input.onlyPeople.length === 0
        ? null
        : [...input.onlyPeople],
    ],
  );

  const requestId = rows[0]?.id;
  if (requestId === undefined) {
    // Lost a race with the same key pressed twice at once. The other press made it.
    const raced = await requestByBundle(tx, input.bundleKey);
    if (!raced) {
      throw new NxError('NX-5001', { detail: 'the request could not be created' });
    }
    return raced;
  }

  if (!draft) {
    await queueChecks(tx, requestId, productCodes, await attemptsAllowed(tx, input.maxAttempts));
  }
  return { requestId, status: draft ? 'DRAFT' : 'QUEUED', entityId, created: true };
}

export interface DraftChanges {
  productCodes: readonly string[];
  /** An IBAN typed after the draft was saved. Replaces the one sealed in it. */
  iban?: string | undefined;
  /** A certificate number typed after the draft was saved. */
  certificateNumber?: string | undefined;
}

/**
 * Writes what changed on a saved draft: its ticked checks, and an IBAN or a certificate number
 * typed since. The number the draft was saved for does not change: a different customer is a
 * new request.
 */
async function applyDraftChanges(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  requestId: string,
  kind: CustomerKind,
  keyVersion: number,
  changes: DraftChanges,
): Promise<string[]> {
  const codes = offeredCodes(await listChecks(tx), kind, changes.productCodes);
  const { subject, problem } = parseSubject(kind, {
    iban: changes.iban,
    certificateNumber: changes.certificateNumber,
  });
  if (problem !== null) {
    throw new NxError('NX-4002', { detail: `the subject is malformed: ${problem}` });
  }
  // Sealed under the draft's own version, so the row stays on one key and rotation moves it whole.
  const key = await keys.encryptionKey(tx.tenantId, keyVersion);
  await tx.query(
    `UPDATE verification_requests
     SET product_codes = $3,
         iban_enc = COALESCE($4, iban_enc),
         certificate_enc = COALESCE($5, certificate_enc)
     WHERE tenant_id = $1 AND id = $2`,
    [
      tx.tenantId,
      requestId,
      codes,
      subject.iban === null ? null : encryptIdentifier(key, 'IBAN', subject.iban),
      subject.certificate === null
        ? null
        : encryptIdentifier(key, 'FREELANCE_DOC', subject.certificate),
    ],
  );
  return codes;
}

/**
 * Runs a saved draft: the checks ticked now, not the ones ticked when it was saved.
 *
 * Pressing twice submits once. A draft already submitted answers with the request it became.
 */
export async function submitDraft(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  requestId: string,
  changes: DraftChanges & { maxAttempts?: number },
): Promise<CreatedRequest> {
  const current = await tx.query<{
    status: RequestStatus;
    kind: CustomerKind;
    entity_id: string | null;
    key_version: number;
  }>(
    `SELECT status, kind, entity_id, key_version FROM verification_requests
     WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tx.tenantId, requestId],
  );
  const row = current.rows[0];
  if (!row || row.status === 'CANCELLED') {
    throw new NxError('NX-4041', { detail: 'draft not found' });
  }
  if (row.status !== 'DRAFT') {
    return { requestId, status: row.status, entityId: row.entity_id, created: false };
  }

  const codes = await applyDraftChanges(tx, keys, requestId, row.kind, row.key_version, changes);
  if (codes.length === 0) {
    throw new NxError('NX-4002', { detail: 'no check of this request applies to this customer' });
  }
  await tx.query(
    `UPDATE verification_requests SET status = 'QUEUED', submitted_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, requestId],
  );
  await queueChecks(tx, requestId, codes, await attemptsAllowed(tx, changes.maxAttempts));
  return { requestId, status: 'QUEUED', entityId: row.entity_id, created: true };
}

/** Keeps a draft as it is now: its ticked checks, and what was typed into it since. */
export async function updateDraft(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  requestId: string,
  changes: DraftChanges,
): Promise<boolean> {
  const { rows } = await tx.query<{ kind: CustomerKind; key_version: number }>(
    `SELECT kind, key_version FROM verification_requests
     WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'
     FOR UPDATE`,
    [tx.tenantId, requestId],
  );
  const row = rows[0];
  if (row === undefined) {
    return false;
  }
  await applyDraftChanges(tx, keys, requestId, row.kind, row.key_version, changes);
  return true;
}

/**
 * Throws a draft away.
 *
 * Marked cancelled rather than deleted: the application role deletes nothing, and the
 * retention sweep removes it with the rest. What was typed goes now, because nothing will
 * ever be run with it.
 */
export async function discardDraft(tx: TenantTransaction, requestId: string): Promise<boolean> {
  const { rowCount } = await tx.query(
    `UPDATE verification_requests
     SET status = 'CANCELLED', completed_at = now(),
         subject_hash = CASE WHEN entity_id IS NULL THEN subject_hash END,
         subject_enc = CASE WHEN entity_id IS NULL THEN subject_enc END,
         subject_type = CASE WHEN entity_id IS NULL THEN subject_type END,
         certificate_enc = NULL, iban_enc = NULL
     WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'`,
    [tx.tenantId, requestId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * A request for some of a draft's checks, run now, with the draft kept for the rest.
 *
 * Pressing one product's button on a saved draft is not submitting the draft. What was typed
 * stays sealed on the server: it is opened here to make the new request, and never travels
 * to the screen and back.
 */
export async function requestFromDraft(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  draftId: string,
  input: Pick<CreateRequestInput, 'productCodes' | 'bundleKey' | 'requestedBy' | 'maxAttempts'> & {
    /** Typed since the draft was saved, and used for this request instead of the draft's. */
    iban?: string | undefined;
    certificateNumber?: string | undefined;
  },
): Promise<CreatedRequest> {
  const existing = await requestByBundle(tx, input.bundleKey);
  if (existing) {
    return existing;
  }
  const { rows } = await tx.query<{
    kind: CustomerKind;
    entity_id: string | null;
    subject_enc: Buffer | null;
    certificate_enc: Buffer | null;
    iban_enc: Buffer | null;
    key_version: number;
  }>(
    `SELECT kind, entity_id, subject_enc, certificate_enc, iban_enc, key_version
     FROM verification_requests
     WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'`,
    [tx.tenantId, draftId],
  );
  const draft = rows[0];
  if (!draft) {
    throw new NxError('NX-4041', { detail: 'draft not found' });
  }
  const key = await keys.encryptionKey(tx.tenantId, draft.key_version);
  const open = (payload: Buffer | null): string | undefined =>
    payload === null ? undefined : decryptIdentifier(key, payload);

  const typed = (value: string | undefined): string | undefined =>
    value === undefined || value.trim() === '' ? undefined : value;

  return createRequest(tx, keys, {
    productCodes: input.productCodes,
    bundleKey: input.bundleKey,
    requestedBy: input.requestedBy,
    ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
    kind: draft.kind,
    entityId: draft.entity_id,
    subject: {
      number: open(draft.subject_enc),
      certificateNumber: typed(input.certificateNumber) ?? open(draft.certificate_enc),
      iban: typed(input.iban) ?? open(draft.iban_enc),
    },
  });
}

export interface RequestCheckView {
  productCode: string;
  status: RequestCheckStatus;
  outcome: RequestOutcome | null;
  noteAr: string | null;
  reference: string | null;
  attempts: number;
  maxAttempts: number;
  updatedAt: Date;
}

export interface RequestView {
  requestId: string;
  status: RequestStatus;
  kind: CustomerKind;
  entityId: string | null;
  /** The customer's name, once a file holds one. */
  displayName: string | null;
  /** The number typed for a customer not on file yet, masked. */
  subjectMasked: string | null;
  /** The IBAN typed with the request, masked. */
  ibanMasked: string | null;
  hasCertificate: boolean;
  productCodes: string[];
  createdAt: Date;
  submittedAt: Date | null;
  completedAt: Date | null;
  checks: RequestCheckView[];
  /** True while a check is still to run. */
  open: boolean;
}

interface RequestRow {
  id: string;
  status: RequestStatus;
  kind: CustomerKind;
  entity_id: string | null;
  display_name: string | null;
  subject_enc: Buffer | null;
  certificate_enc: Buffer | null;
  iban_enc: Buffer | null;
  key_version: number;
  product_codes: string[];
  created_at: Date;
  submitted_at: Date | null;
  completed_at: Date | null;
}

async function masked(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  version: number,
  payload: Buffer | null,
): Promise<string | null> {
  if (payload === null) {
    return null;
  }
  // Decrypted to be masked, and only the masked form leaves this function.
  return maskIdentifier(decryptIdentifier(await keys.encryptionKey(tx.tenantId, version), payload));
}

export async function getRequest(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  requestId: string,
): Promise<RequestView | null> {
  const { rows } = await tx.query<RequestRow>(
    `SELECT r.id, r.status, r.kind, r.entity_id, e.display_name, r.subject_enc,
            r.certificate_enc, r.iban_enc, r.key_version, r.product_codes, r.created_at,
            r.submitted_at, r.completed_at
     FROM verification_requests r
     LEFT JOIN entities e ON e.tenant_id = r.tenant_id AND e.id = r.entity_id
     WHERE r.tenant_id = $1 AND r.id = $2`,
    [tx.tenantId, requestId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }

  const { rows: checkRows } = await tx.query<{
    product_code: string;
    status: RequestCheckStatus;
    outcome: RequestOutcome | null;
    note_ar: string | null;
    reference: string | null;
    attempts: number;
    max_attempts: number;
    updated_at: Date;
  }>(
    `SELECT c.product_code, c.status, c.outcome, c.note_ar, c.reference, c.attempts,
            c.max_attempts, c.updated_at
     FROM verification_request_checks c
     JOIN products p ON p.code = c.product_code
     WHERE c.tenant_id = $1 AND c.request_id = $2
     ORDER BY p.check_order, c.product_code`,
    [tx.tenantId, requestId],
  );

  const checks = checkRows.map((check) => ({
    productCode: check.product_code,
    status: check.status,
    outcome: check.outcome,
    noteAr: check.note_ar,
    reference: check.reference,
    attempts: check.attempts,
    maxAttempts: check.max_attempts,
    updatedAt: check.updated_at,
  }));

  return {
    requestId: row.id,
    status: row.status,
    kind: row.kind,
    entityId: row.entity_id,
    displayName: row.display_name,
    subjectMasked: await masked(tx, keys, row.key_version, row.subject_enc),
    ibanMasked: await masked(tx, keys, row.key_version, row.iban_enc),
    hasCertificate: row.certificate_enc !== null,
    productCodes: row.product_codes,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    checks,
    open:
      row.status === 'QUEUED' ||
      row.status === 'RUNNING' ||
      checks.some((check) => check.status === 'QUEUED' || check.status === 'RUNNING'),
  };
}

export interface DraftSummary {
  requestId: string;
  kind: CustomerKind;
  /** The customer's name, or the number typed, masked. */
  label: string;
  productCount: number;
  createdAt: Date;
}

export async function listDrafts(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  limit = 5,
): Promise<DraftSummary[]> {
  const { rows } = await tx.query<RequestRow>(
    `SELECT r.id, r.status, r.kind, r.entity_id, e.display_name, r.subject_enc,
            r.certificate_enc, r.iban_enc, r.key_version, r.product_codes, r.created_at,
            r.submitted_at, r.completed_at
     FROM verification_requests r
     LEFT JOIN entities e ON e.tenant_id = r.tenant_id AND e.id = r.entity_id
     WHERE r.tenant_id = $1 AND r.status = 'DRAFT'
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [tx.tenantId, limit],
  );
  const drafts: DraftSummary[] = [];
  for (const row of rows) {
    drafts.push({
      requestId: row.id,
      kind: row.kind,
      label: row.display_name ?? (await masked(tx, keys, row.key_version, row.subject_enc)) ?? '',
      productCount: row.product_codes.length,
      createdAt: row.created_at,
    });
  }
  return drafts;
}

// ---------------------------------------------------------------------------------------
// Where each check stands for a customer, as the rows of the request screen show it.
// ---------------------------------------------------------------------------------------

export type ProductState =
  | 'NOT_VERIFIED'
  | 'VERIFIED'
  | 'EXPIRED'
  | 'CHANGED'
  | 'CONFLICT'
  | 'PARTIAL'
  | 'NOT_FOUND'
  | 'FAILED'
  | 'RUNNING'
  | 'NOT_APPLICABLE'
  | 'COMING_SOON';

export interface ProductStanding {
  productCode: string;
  state: ProductState;
  /** When it last came back verified, for «مُتحقق سابقاً · 12 سبتمبر». */
  verifiedAt: Date | null;
  /** The few words a conflict or a partial result is tagged with. */
  issueAr: string | null;
  /** A result is on file, so the button reads «إعادة التحقق». */
  hasResult: boolean;
}

export type LookupStatus = 'EMPTY' | 'INVALID' | 'FOUND' | 'NEW' | 'REGISTRATION_UNKNOWN';

export interface CustomerLookup {
  status: LookupStatus;
  entityId: string | null;
  displayName: string | null;
  /** The file's own number, masked. */
  identifierMasked: string | null;
  /** The kind the file says, when it says one. The screen switches to it. */
  kind: CustomerKind | null;
  /** The account on file, masked, so the banking row can say which it will check. */
  accountMasked: string | null;
  /** How many managers are known: a manager check is one operation for each. */
  managers: number;
  /** A certificate number is on file, so the certificate row needs none typed. */
  hasCertificate: boolean;
  standings: ProductStanding[];
}

const SUCCESS = ['OK', 'PARTIAL'];

/** The rows of a customer not on file yet: nothing verified, and what does not apply. */
function freshStandings(
  catalogue: readonly CheckDefinition[],
  kind: CustomerKind,
): ProductStanding[] {
  return catalogue.map((check) => ({
    productCode: check.productCode,
    state: !check.appliesTo.includes(kind)
      ? 'NOT_APPLICABLE'
      : check.availability !== 'AVAILABLE'
        ? 'COMING_SOON'
        : 'NOT_VERIFIED',
    verifiedAt: null,
    issueAr: null,
    hasResult: false,
  }));
}

/**
 * Where every check in the catalogue stands for one customer.
 *
 * Read from the customer's file, so a row on this screen and the section on the file never
 * disagree: a section in conflict tags its checks in conflict, an expired one tags them
 * expired. What the file does not know, this reads from the runs: whether the check was
 * ever run, whether it failed, and whether one is running now.
 */
export async function customerStandings(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  entityId: string,
  requestedKind: CustomerKind,
): Promise<CustomerLookup | null> {
  const file = await getCustomerFile(tx, keys, entityId);
  if (!file) {
    return null;
  }
  const catalogue = await listChecks(tx);
  const kind: CustomerKind =
    file.entityType === 'FREELANCER' ? 'FREELANCER' : (file.kind ?? requestedKind);

  const { rows: runs } = await tx.query<{
    product_code: string;
    status: string;
    created_at: Date;
    last_success: Date | null;
  }>(
    `SELECT DISTINCT ON (product_code) product_code, status, created_at,
            (SELECT max(s.created_at) FROM verification_runs s
             WHERE s.tenant_id = r.tenant_id AND s.entity_id = r.entity_id
               AND s.product_code = r.product_code AND s.status = ANY($3::text[])) AS last_success
     FROM verification_runs r
     WHERE r.tenant_id = $1 AND r.entity_id = $2 AND r.status <> 'PENDING'
     ORDER BY product_code, created_at DESC`,
    [tx.tenantId, entityId, SUCCESS],
  );
  const lastRun = new Map(runs.map((run) => [run.product_code, run]));

  const running = new Set(await openChecksFor(tx, entityId));

  const standings = catalogue.map((check): ProductStanding => {
    const base = {
      productCode: check.productCode,
      verifiedAt: null,
      issueAr: null,
      hasResult: false,
    };
    if (!check.appliesTo.includes(kind)) {
      return { ...base, state: 'NOT_APPLICABLE' };
    }
    if (check.availability !== 'AVAILABLE') {
      return { ...base, state: 'COMING_SOON' };
    }
    const run = lastRun.get(check.productCode);
    const hasResult = run !== undefined;
    if (running.has(check.productCode)) {
      return { ...base, state: 'RUNNING', hasResult, verifiedAt: run?.last_success ?? null };
    }
    if (!run) {
      return { ...base, state: 'NOT_VERIFIED' };
    }
    if (run.last_success === null) {
      return {
        ...base,
        hasResult,
        state:
          run.status === 'NOT_FOUND'
            ? 'NOT_FOUND'
            : run.status === 'ERROR'
              ? 'FAILED'
              : 'NOT_VERIFIED',
      };
    }

    const section = file.sections.find((candidate) =>
      candidate.checks.some((inSection) => inSection.productCode === check.productCode),
    );
    const verified = { ...base, hasResult, verifiedAt: run.last_success };
    switch (section?.state) {
      case 'CONFLICT':
        return {
          ...verified,
          state: 'CONFLICT',
          // Screen 02 words a bank name conflict the way its row has room for.
          issueAr: section.issueAr === 'تعارض في الاسم' ? 'اسم غير مطابق' : section.issueAr,
        };
      case 'CHANGED':
        return { ...verified, state: 'CHANGED' };
      case 'EXPIRED':
        return { ...verified, state: 'EXPIRED' };
      case 'PARTIAL':
        return { ...verified, state: 'PARTIAL', issueAr: section.issueAr };
      default:
        return { ...verified, state: 'VERIFIED' };
    }
  });

  return {
    status: 'FOUND',
    entityId,
    displayName: file.displayName,
    identifierMasked: file.primaryIdentifier?.masked ?? null,
    kind: file.entityType === 'FREELANCER' ? 'FREELANCER' : file.kind,
    accountMasked: file.accounts[0]?.maskedIban ?? null,
    managers: file.managers.length,
    hasCertificate: file.identifiers.some((identifier) => identifier.idType === 'FREELANCE_DOC'),
    standings,
  };
}

/** Finds the customer a typed number belongs to, and where each check stands for them. */
export async function lookupCustomer(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  input: { kind: CustomerKind; number: string },
): Promise<CustomerLookup> {
  const catalogue = await listChecks(tx);
  const empty: CustomerLookup = {
    status: 'EMPTY',
    entityId: null,
    displayName: null,
    identifierMasked: null,
    kind: null,
    accountMasked: null,
    managers: 0,
    hasCertificate: false,
    standings: freshStandings(catalogue, input.kind),
  };

  const { subject, problem } = parseSubject(input.kind, { number: input.number });
  if (subject.number === null) {
    return empty;
  }
  if (problem !== null || subject.idType === null) {
    return { ...empty, status: 'INVALID' };
  }

  const entityId = await findEntityIdByIdentifier(tx, keys, subject.idType, subject.number);
  if (entityId === null) {
    return { ...empty, status: subject.idType === 'CR' ? 'REGISTRATION_UNKNOWN' : 'NEW' };
  }
  return (await customerStandings(tx, keys, entityId, input.kind)) ?? { ...empty, status: 'NEW' };
}

// ---------------------------------------------------------------------------------------
// Running a request.
// ---------------------------------------------------------------------------------------

export interface ExecuteRequestOptions {
  /** A check a runner has held this long is taken to have been abandoned. */
  staleAfterSeconds?: number;
  /** How long a check that could not reach the authority waits before it is tried again. */
  retryDelaySeconds?: number;
  /** The longest this call waits for such a retry before leaving it to the next sweep. */
  maxWaitSeconds?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface ClaimedCheck {
  kind: 'claimed';
  productCode: string;
  attempts: number;
  maxAttempts: number;
  requestKind: CustomerKind;
  entityId: string | null;
  bundleKey: string;
  requestedBy: string | null;
  identity: CustomerIdentity;
  iban: string | null;
  onlyPeople: string[] | null;
}

type Claim = ClaimedCheck | { kind: 'none' } | { kind: 'wait'; milliseconds: number };

/**
 * Takes the next check of a request, under the request's lock.
 *
 * Strictly in the catalogue's order, and one at a time: a check that is waiting to be tried
 * again holds back the ones after it, because the manager check needs the registry read
 * first. A check another runner holds and has not abandoned means this runner leaves.
 */
async function claimNextCheck(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  requestId: string,
  staleAfterSeconds: number,
): Promise<Claim> {
  const { rows } = await tx.query<{
    status: RequestStatus;
    kind: CustomerKind;
    entity_id: string | null;
    subject_type: IdentifierType | null;
    subject_enc: Buffer | null;
    certificate_enc: Buffer | null;
    iban_enc: Buffer | null;
    key_version: number;
    bundle_key: string;
    requested_by: string | null;
    person_ids: string[] | null;
  }>(
    `SELECT status, kind, entity_id, subject_type, subject_enc, certificate_enc, iban_enc,
            key_version, bundle_key, requested_by, person_ids
     FROM verification_requests
     WHERE tenant_id = $1 AND id = $2
     FOR UPDATE`,
    [tx.tenantId, requestId],
  );
  const request = rows[0];
  if (!request || (request.status !== 'QUEUED' && request.status !== 'RUNNING')) {
    return { kind: 'none' };
  }

  const { rows: pending } = await tx.query<{
    product_code: string;
    status: RequestCheckStatus;
    held: boolean;
    wait_ms: number | null;
  }>(
    `SELECT c.product_code, c.status,
            (c.status = 'RUNNING' AND c.locked_at > now() - make_interval(secs => $3)) AS held,
            CASE WHEN c.retry_at > now()
                 THEN ceil(extract(epoch FROM c.retry_at - now()) * 1000)::int END AS wait_ms
     FROM verification_request_checks c
     JOIN products p ON p.code = c.product_code
     WHERE c.tenant_id = $1 AND c.request_id = $2 AND c.status IN ('QUEUED', 'RUNNING')
     ORDER BY p.check_order, c.product_code`,
    [tx.tenantId, requestId, staleAfterSeconds],
  );

  if (pending.length === 0) {
    await finishRequest(tx, requestId);
    return { kind: 'none' };
  }
  if (pending.some((check) => check.held)) {
    return { kind: 'none' };
  }
  const next = pending[0] as (typeof pending)[number];
  if (next.wait_ms !== null) {
    return { kind: 'wait', milliseconds: next.wait_ms };
  }

  // A check taken back from a runner that stopped keeps its attempt, and so its keys.
  const { rows: claimed } = await tx.query<{ attempts: number; max_attempts: number }>(
    `UPDATE verification_request_checks
     SET attempts = CASE WHEN status = 'QUEUED' THEN attempts + 1 ELSE attempts END,
         status = 'RUNNING', locked_at = now(), retry_at = NULL, updated_at = now()
     WHERE tenant_id = $1 AND request_id = $2 AND product_code = $3
     RETURNING attempts, max_attempts`,
    [tx.tenantId, requestId, next.product_code],
  );
  await tx.query(
    `UPDATE verification_requests SET status = 'RUNNING'
     WHERE tenant_id = $1 AND id = $2 AND status = 'QUEUED'`,
    [tx.tenantId, requestId],
  );

  // Decrypted for the call to the authority and for nothing else.
  const key = await keys.encryptionKey(tx.tenantId, request.key_version);
  const number = request.subject_enc === null ? null : decryptIdentifier(key, request.subject_enc);
  const certificate =
    request.certificate_enc === null
      ? null
      : certificateForCall(decryptIdentifier(key, request.certificate_enc));
  const identity: CustomerIdentity = {};
  if (number !== null) {
    if (request.subject_type === 'UNN') {
      identity.unn = number;
    } else {
      identity.nationalId = number;
    }
  }
  if (certificate !== null) {
    identity.certificateNumber = certificate;
  }

  return {
    kind: 'claimed',
    productCode: next.product_code,
    attempts: claimed[0]?.attempts ?? 1,
    maxAttempts: claimed[0]?.max_attempts ?? 1,
    requestKind: request.kind,
    entityId: request.entity_id,
    bundleKey: request.bundle_key,
    requestedBy: request.requested_by,
    identity,
    iban: request.iban_enc === null ? null : decryptIdentifier(key, request.iban_enc),
    onlyPeople: request.person_ids,
  };
}

/**
 * Closes a request whose checks have all ended.
 *
 * What was typed is dropped here: the file now holds the customer's identifiers, sealed
 * under its own rows, and a finished request has no further call to make with them.
 */
async function finishRequest(tx: TenantTransaction, requestId: string): Promise<void> {
  await tx.query(
    `UPDATE verification_requests
     SET status = 'DONE', completed_at = now(),
         subject_hash = CASE WHEN entity_id IS NULL THEN subject_hash END,
         subject_enc = CASE WHEN entity_id IS NULL THEN subject_enc END,
         subject_type = CASE WHEN entity_id IS NULL THEN subject_type END,
         certificate_enc = NULL, iban_enc = NULL
     WHERE tenant_id = $1 AND id = $2 AND status IN ('QUEUED', 'RUNNING')`,
    [tx.tenantId, requestId],
  );
}

const UNREACHABLE_AR =
  'تعذّر الوصول إلى الجهة الرسمية الآن. لم تُحتسب العملية، ويمكن إعادة المحاولة.';

interface Settlement {
  status: RequestCheckStatus;
  outcome: RequestOutcome;
  noteAr: string | null;
  reference: string | null;
}

/**
 * What one check of a request ended in, from every call it made.
 *
 * A manager check is a call per manager, so its outcome is theirs together: every one
 * found, some, or none. A call that could not reach the authority makes the whole check go
 * again while attempts remain, and only that call is made again.
 */
export function settleCheck(
  outcomes: readonly Pick<CheckOutcome, 'status' | 'noteAr' | 'reference'>[],
  attempts: number,
  maxAttempts: number,
): Settlement {
  const reference = outcomes.find((outcome) => outcome.reference !== null)?.reference ?? null;
  const errors = outcomes.filter((outcome) => outcome.status === 'ERROR');
  if (errors.length > 0) {
    return {
      status: attempts < maxAttempts ? 'QUEUED' : 'FAILED',
      outcome: 'ERROR',
      noteAr: errors[0]?.noteAr ?? UNREACHABLE_AR,
      reference,
    };
  }

  const ran = outcomes.filter(
    (outcome) => outcome.status !== 'SKIPPED' && outcome.status !== 'REFUSED',
  );
  const refused = outcomes.find((outcome) => outcome.status === 'REFUSED');
  if (ran.length === 0) {
    return refused
      ? { status: 'FAILED', outcome: 'REFUSED', noteAr: refused.noteAr, reference }
      : {
          status: 'SKIPPED',
          outcome: 'SKIPPED',
          noteAr: outcomes[0]?.noteAr ?? null,
          reference,
        };
  }

  const statuses = ran.map((outcome) => outcome.status);
  const outcome: RequestOutcome = statuses.includes('AWAITING')
    ? 'AWAITING'
    : statuses.every((status) => status === 'NOT_FOUND')
      ? 'NOT_FOUND'
      : statuses.every((status) => status === 'OK') && refused === undefined
        ? 'OK'
        : 'PARTIAL';
  return {
    status: 'DONE',
    outcome,
    noteAr: refused?.noteAr ?? ran.find((candidate) => candidate.noteAr !== null)?.noteAr ?? null,
    reference,
  };
}

export async function executeRequest(
  deps: RunChecksDependencies,
  requestId: string,
  options: ExecuteRequestOptions = {},
): Promise<void> {
  const staleAfterSeconds = options.staleAfterSeconds ?? 600;
  const retryDelaySeconds = options.retryDelaySeconds ?? 10;
  const maxWaitMs = (options.maxWaitSeconds ?? 30) * 1000;
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds)));

  for (;;) {
    const claim = await deps.inTenant((tx) =>
      claimNextCheck(tx, deps.keys, requestId, staleAfterSeconds),
    );
    if (claim.kind === 'none') {
      return;
    }
    if (claim.kind === 'wait') {
      if (claim.milliseconds > maxWaitMs) {
        return;
      }
      await sleep(claim.milliseconds);
      continue;
    }

    // On a later attempt, the managers whose calls already settled are not called again.
    const settled =
      claim.attempts > 1
        ? await deps.inTenant((tx) => settledPeople(tx, claim.bundleKey, claim.productCode))
        : new Map<string, { status: CheckOutcome['status']; reference: string | null }>();

    let outcomes: Pick<CheckOutcome, 'status' | 'noteAr' | 'reference'>[];
    let entityId = claim.entityId;
    try {
      const result = await runChecks(deps, {
        entityId: claim.entityId,
        kind: claim.requestKind === 'FREELANCER' ? 'FREELANCER' : 'BUSINESS',
        identity: claim.identity,
        productCodes: [claim.productCode],
        ...(claim.iban === null ? {} : { inputs: { iban: claim.iban } }),
        bundleKey: claim.bundleKey,
        attempt: claim.attempts,
        requestedBy: claim.requestedBy,
        ...(settled.size > 0 ? { skipPeople: [...settled.keys()] } : {}),
        ...(claim.onlyPeople === null ? {} : { onlyPeople: claim.onlyPeople }),
      });
      entityId = result.entityId ?? entityId;
      outcomes = [
        ...[...settled.values()].map((run) => ({ ...run, noteAr: null })),
        ...result.outcomes,
      ];
    } catch {
      // runChecks answers for each call itself. What reaches here is the platform failing
      // around it, which is recorded as a failed attempt so the check is tried again.
      outcomes = [{ status: 'ERROR', noteAr: UNREACHABLE_AR, reference: null }];
    }

    const settlement = settleCheck(outcomes, claim.attempts, claim.maxAttempts);
    await deps.inTenant(async (tx) => {
      await tx.query(
        `UPDATE verification_request_checks
         SET status = $4, outcome = $5, note_ar = $6, reference = COALESCE($7, reference),
             locked_at = NULL, updated_at = now(),
             retry_at = CASE WHEN $4 = 'QUEUED' THEN now() + make_interval(secs => $8) END
         WHERE tenant_id = $1 AND request_id = $2 AND product_code = $3`,
        [
          tx.tenantId,
          requestId,
          claim.productCode,
          settlement.status,
          settlement.outcome,
          settlement.noteAr,
          settlement.reference,
          retryDelaySeconds,
        ],
      );
      if (entityId !== null) {
        await tx.query(
          `UPDATE verification_requests SET entity_id = COALESCE(entity_id, $3)
           WHERE tenant_id = $1 AND id = $2`,
          [tx.tenantId, requestId, entityId],
        );
      }
    });
  }
}

/** The checks queued or running for a customer, from any request, so a screen can say so. */
export async function openChecksFor(tx: TenantTransaction, entityId: string): Promise<string[]> {
  const { rows } = await tx.query<{ product_code: string }>(
    `SELECT DISTINCT c.product_code
     FROM verification_request_checks c
     JOIN verification_requests r ON r.tenant_id = c.tenant_id AND r.id = c.request_id
     WHERE c.tenant_id = $1 AND r.entity_id = $2 AND c.status IN ('QUEUED', 'RUNNING')
     ORDER BY c.product_code`,
    [tx.tenantId, entityId],
  );
  return rows.map((row) => row.product_code);
}

/** Whether this workspace has a request waiting to run, before anything is built for one. */
export async function hasOpenRequests(tx: TenantTransaction): Promise<boolean> {
  const { rows } = await tx.query<{ open: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM verification_requests
       WHERE tenant_id = $1 AND status IN ('QUEUED', 'RUNNING')
     ) AS open`,
    [tx.tenantId],
  );
  return rows[0]?.open === true;
}

export interface ResumeRequestsOptions extends ExecuteRequestOptions {
  /** A request younger than this is left to the runner that took it when it was pressed. */
  graceSeconds?: number;
  /** A request still open after this long is closed, and its open checks marked failed. */
  expireAfterHours?: number;
  limit?: number;
}

const EXPIRED_AR = 'انتهت مهلة تنفيذ هذه العملية ولم تُحتسب. أعد المحاولة.';

/**
 * The worker's sweep: requests nobody is running.
 *
 * The console runs a request the moment it is pressed, in the background of that request.
 * A deployment restarting, a lost connection or a retry scheduled for later leaves some
 * behind, and this picks them up. The lock in claimNextCheck makes it safe to run beside
 * the console: whoever holds a check keeps it.
 */
export async function resumeRequests(
  deps: RunChecksDependencies,
  options: ResumeRequestsOptions = {},
): Promise<number> {
  const graceSeconds = options.graceSeconds ?? 30;
  const expireAfterHours = options.expireAfterHours ?? 24;

  await deps.inTenant(async (tx) => {
    await tx.query(
      `UPDATE verification_request_checks c
       SET status = 'FAILED', outcome = COALESCE(c.outcome, 'ERROR'), note_ar = $3,
           locked_at = NULL, retry_at = NULL, updated_at = now()
       FROM verification_requests r
       WHERE c.tenant_id = $1 AND r.tenant_id = c.tenant_id AND r.id = c.request_id
         AND r.status IN ('QUEUED', 'RUNNING') AND c.status IN ('QUEUED', 'RUNNING')
         AND r.submitted_at < now() - make_interval(hours => $2)`,
      [tx.tenantId, expireAfterHours, EXPIRED_AR],
    );
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM verification_requests
       WHERE tenant_id = $1 AND status IN ('QUEUED', 'RUNNING')
         AND submitted_at < now() - make_interval(hours => $2)`,
      [tx.tenantId, expireAfterHours],
    );
    for (const row of rows) {
      await finishRequest(tx, row.id);
    }
  });

  const { rows } = await deps.inTenant((tx) =>
    tx.query<{ id: string }>(
      `SELECT id FROM verification_requests
       WHERE tenant_id = $1 AND status IN ('QUEUED', 'RUNNING')
         AND submitted_at < now() - make_interval(secs => $2)
       ORDER BY submitted_at
       LIMIT $3`,
      [tx.tenantId, graceSeconds, options.limit ?? 10],
    ),
  );
  for (const row of rows) {
    await executeRequest(deps, row.id, { maxWaitSeconds: 0, ...options });
  }
  return rows.length;
}

// ---------------------------------------------------------------------------------------
// The subscriber's own choices about the portal.
// ---------------------------------------------------------------------------------------

export interface TenantPreferences {
  /** Whether the verification screens show what each check costs. */
  showPrices: boolean;
}

export async function getPreferences(tx: TenantTransaction): Promise<TenantPreferences> {
  const { rows } = await tx.query<{ show_prices: boolean }>(
    `SELECT show_prices FROM tenant_preferences WHERE tenant_id = $1`,
    [tx.tenantId],
  );
  return { showPrices: rows[0]?.show_prices ?? true };
}

export async function setPreferences(
  tx: TenantTransaction,
  preferences: TenantPreferences,
): Promise<TenantPreferences> {
  await tx.query(
    `INSERT INTO tenant_preferences (tenant_id, show_prices) VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET show_prices = EXCLUDED.show_prices, updated_at = now()`,
    [tx.tenantId, preferences.showPrices],
  );
  return preferences;
}
