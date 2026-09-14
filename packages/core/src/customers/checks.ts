import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import type { IdentifierType } from '../crypto/identifier.js';
import type { StepRunner } from '../orchestration/executor.js';
import type { IdentifierInput } from '../repositories/entities.js';
import { revealIdentifier } from '../repositories/identifiers.js';
import { verify } from '../verification/verify.js';

/**
 * The checks of a customer file, and running the ones a person ticked.
 *
 * A check is a product that names a section of the file (rule 8), so the list below is read
 * from the catalogue and nothing here knows a product code. What this adds is the
 * behaviour of a full verification the owner described, and the three things that make it
 * safe to press one button for several paid calls:
 *
 *   - Each check runs in its own transaction. A balance that runs out on the fourth check
 *     leaves the first three recorded and charged, and says why the fourth did not run,
 *     rather than rolling back work that was done and paid for at the source.
 *   - Each check's idempotency key is derived from one key issued with the form, so a
 *     double click, a refresh or a retry is the same verification and one set of charges
 *     (rule 7).
 *   - A check that cannot apply is skipped before it is called, with the reason: articles
 *     of association for a sole establishment, an IBAN check with no IBAN, a manager check
 *     with no known managers. Nothing is billed for a call that was never made.
 */

export type CustomerKind = 'COMPANY' | 'ESTABLISHMENT' | 'FREELANCER';
export type ProfileSection =
  'REGISTRY' | 'CONTRACT' | 'MANAGERS' | 'ADDRESS' | 'BANKING' | 'FREELANCE' | 'PROPERTY';

export interface CheckDefinition {
  productCode: string;
  nameAr: string;
  section: ProfileSection;
  appliesTo: CustomerKind[];
  order: number;
  availability: 'AVAILABLE' | 'COMING_SOON';
  /** What the subject must carry, from the product's own schema. */
  requiredInputs: string[];
  /** What the subject may carry. Anything else is refused by the schema. */
  allowedInputs: string[];
}

export async function listChecks(tx: TenantTransaction): Promise<CheckDefinition[]> {
  const { rows } = await tx.query<{
    code: string;
    name_ar: string;
    profile_section: ProfileSection;
    applies_to: CustomerKind[];
    check_order: number;
    availability: 'AVAILABLE' | 'COMING_SOON';
    input_schema: { required?: string[]; properties?: Record<string, unknown> };
  }>(
    `SELECT code, name_ar, profile_section, applies_to, check_order, availability, input_schema
     FROM products
     WHERE profile_section IS NOT NULL AND status = 'active'
       AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
     ORDER BY check_order, code`,
  );

  return rows.map((row) => ({
    productCode: row.code,
    nameAr: row.name_ar,
    section: row.profile_section,
    appliesTo: row.applies_to,
    order: row.check_order,
    availability: row.availability,
    requiredInputs: Array.isArray(row.input_schema.required) ? row.input_schema.required : [],
    allowedInputs: Object.keys(row.input_schema.properties ?? {}),
  }));
}

/**
 * The checks a customer of this kind is offered.
 *
 * A business whose registry record has not been read yet could be either a company or a
 * sole establishment, so it is offered what either would be.
 */
export function checksFor(
  checks: readonly CheckDefinition[],
  kind: CustomerKind | 'BUSINESS',
): CheckDefinition[] {
  const kinds: CustomerKind[] = kind === 'BUSINESS' ? ['COMPANY', 'ESTABLISHMENT'] : [kind];
  return checks.filter((check) => check.appliesTo.some((applies) => kinds.includes(applies)));
}

export interface CustomerIdentity {
  /** A business: its unified number. */
  unn?: string;
  /** A freelancer: national or residence ID, and certificate number. */
  nationalId?: string;
  certificateNumber?: string;
}

export interface RunChecksInput {
  /** The customer, when the file already exists. Absent for a new customer. */
  entityId?: string | null;
  kind: 'BUSINESS' | 'FREELANCER';
  identity: CustomerIdentity;
  productCodes: readonly string[];
  /** Inputs a check needs beyond the customer's identity, such as an IBAN. */
  inputs?: { iban?: string };
  /** Issued with the form. Every check's idempotency key derives from it. */
  bundleKey: string;
  requestedBy: string | null;
  /** How many managers one full verification checks at most. */
  managerLimit?: number;
  /** Check only these managers, by entity. Absent means every known manager. */
  onlyPeople?: readonly string[];
}

export type CheckStatus =
  'OK' | 'PARTIAL' | 'NOT_FOUND' | 'ERROR' | 'AWAITING' | 'SKIPPED' | 'REFUSED';

export interface CheckOutcome {
  productCode: string;
  status: CheckStatus;
  reference: string | null;
  /** Why a check did not run, or what it found, in words a person can act on. */
  noteAr: string | null;
  /** The person a manager check was about, by entity, when it was about one. */
  personEntityId?: string;
}

export interface RunChecksResult {
  entityId: string | null;
  outcomes: CheckOutcome[];
}

export interface RunChecksDependencies {
  /** Runs one unit of work in its own transaction, scoped to the subscriber. */
  inTenant: <T>(work: (tx: TenantTransaction) => Promise<T>) => Promise<T>;
  keys: TenantKeyProvider;
  runStepFor: (tx: TenantTransaction) => StepRunner;
}

/**
 * Why a check was refused, in words a person can act on.
 *
 * Read from the error's code and, where one code covers several refusals, from the detail
 * the domain wrote. The detail never reaches the screen: only the sentence chosen here does.
 */
export function refusalFor(error: unknown): string {
  if (!(error instanceof NxError)) {
    return 'تعذّر تنفيذ هذه العملية.';
  }
  const detail = error.message.toLowerCase();
  if (detail.includes('insufficient balance')) {
    return 'الرصيد لا يكفي لهذه العملية. اشحن الرصيد ثم أعد المحاولة.';
  }
  switch (error.code) {
    case 'NX-4031':
      return detail.includes('not available yet')
        ? 'هذه العملية قادمة قريباً ولم تُفعَّل بعد.'
        : 'باقتك لا تشمل هذه العملية، أو استُنفدت حصتها لهذه المدة.';
    case 'NX-4002':
      return 'البيانات المدخلة لا تطابق الصيغة المطلوبة.';
    case 'NX-4091':
      return 'هذا المعرّف مسجل لعميل آخر في مساحة عملك.';
    case 'NX-5002':
      return 'الخدمة غير متاحة مؤقتاً. أعد المحاولة بعد قليل.';
    default:
      return 'تعذّر تنفيذ هذه العملية.';
  }
}

function identifiersOf(
  kind: 'BUSINESS' | 'FREELANCER',
  identity: CustomerIdentity,
): IdentifierInput[] {
  if (kind === 'BUSINESS') {
    return identity.unn ? [{ idType: 'UNN', value: identity.unn, isPrimary: true }] : [];
  }
  const identifiers: IdentifierInput[] = [];
  if (identity.nationalId) {
    identifiers.push({
      idType: identity.nationalId.startsWith('2') ? 'IQAMA' : 'NATIONAL_ID',
      value: identity.nationalId,
      isPrimary: true,
    });
  }
  if (identity.certificateNumber) {
    identifiers.push({ idType: 'FREELANCE_DOC', value: identity.certificateNumber });
  }
  return identifiers;
}

/** The subject a check is sent with, built from the customer's identity and the inputs given. */
function subjectFor(
  check: CheckDefinition,
  kind: 'BUSINESS' | 'FREELANCER',
  identity: CustomerIdentity,
  inputs: RunChecksInput['inputs'],
): Record<string, unknown> {
  const available: Record<string, unknown> = {
    unn: identity.unn,
    national_id: identity.nationalId,
    certificate_number: identity.certificateNumber,
    iban: inputs?.iban,
    account_type: kind === 'FREELANCER' ? 'FREELANCER' : 'BUSINESS',
  };
  const subject: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(available)) {
    // Only what this product's schema names: most refuse properties they do not expect.
    if (value !== undefined && value !== '' && check.allowedInputs.includes(key)) {
      subject[key] = value;
    }
  }
  return subject;
}

async function knownKind(tx: TenantTransaction, entityId: string): Promise<CustomerKind | null> {
  const { rows } = await tx.query<{ entity_type: string; kind: unknown }>(
    `SELECT e.entity_type,
            (SELECT p.value FROM entity_profile p
             WHERE p.tenant_id = e.tenant_id AND p.entity_id = e.id AND p.field_path = 'cr.kind') AS kind
     FROM entities e WHERE e.tenant_id = $1 AND e.id = $2`,
    [tx.tenantId, entityId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  if (row.entity_type === 'FREELANCER' || row.entity_type === 'PERSON') {
    return 'FREELANCER';
  }
  return row.kind === 'COMPANY' || row.kind === 'ESTABLISHMENT' ? row.kind : null;
}

async function managersOf(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  companyId: string,
  limit: number,
): Promise<{ personId: string; id: string }[]> {
  const { rows } = await tx.query<{ to_entity: string }>(
    `SELECT DISTINCT to_entity FROM entity_relations
     WHERE tenant_id = $1 AND from_entity = $2 AND rel_type = 'MANAGES' AND ended_at IS NULL
     LIMIT $3`,
    [tx.tenantId, companyId, limit],
  );
  const managers: { personId: string; id: string }[] = [];
  for (const row of rows) {
    // Decrypted for the call to the authority and for nothing else.
    const revealed = await revealIdentifier(tx, keys, row.to_entity, [
      'NATIONAL_ID',
      'IQAMA',
    ] as IdentifierType[]);
    if (revealed) {
      managers.push({ personId: row.to_entity, id: revealed.value });
    }
  }
  return managers;
}

async function latestAccountIban(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  entityId: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ to_entity: string }>(
    `SELECT to_entity FROM entity_relations
     WHERE tenant_id = $1 AND from_entity = $2 AND rel_type = 'HOLDS_ACCOUNT' AND ended_at IS NULL
     ORDER BY valid_from DESC LIMIT 1`,
    [tx.tenantId, entityId],
  );
  const account = rows[0]?.to_entity;
  if (!account) {
    return null;
  }
  // Decrypted for the call to the authority and for nothing else.
  const revealed = await revealIdentifier(tx, keys, account, ['IBAN']);
  return revealed?.value ?? null;
}

async function identityOf(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  entityId: string,
  kind: 'BUSINESS' | 'FREELANCER',
): Promise<CustomerIdentity> {
  if (kind === 'BUSINESS') {
    const unn = await revealIdentifier(tx, keys, entityId, ['UNN']);
    return unn ? { unn: unn.value } : {};
  }
  const nationalId = await revealIdentifier(tx, keys, entityId, ['NATIONAL_ID', 'IQAMA']);
  const certificate = await revealIdentifier(tx, keys, entityId, ['FREELANCE_DOC']);
  return {
    ...(nationalId ? { nationalId: nationalId.value } : {}),
    ...(certificate ? { certificateNumber: certificate.value } : {}),
  };
}

export async function runChecks(
  deps: RunChecksDependencies,
  input: RunChecksInput,
): Promise<RunChecksResult> {
  const catalogue = await deps.inTenant((tx) => listChecks(tx));
  const byCode = new Map(catalogue.map((check) => [check.productCode, check]));
  const selected = input.productCodes
    .map((code) => byCode.get(code))
    .filter((check): check is CheckDefinition => check !== undefined)
    .sort((left, right) => left.order - right.order);

  let entityId = input.entityId ?? null;
  // An existing file brings its own identity, read from the encrypted identifiers rather
  // than from anything the form could have been edited to send.
  const identity: CustomerIdentity =
    entityId !== null
      ? {
          ...(await deps.inTenant((tx) =>
            identityOf(tx, deps.keys, entityId as string, input.kind),
          )),
          ...input.identity,
        }
      : input.identity;

  const outcomes: CheckOutcome[] = [];
  const managerLimit = input.managerLimit ?? 10;

  // Re-verifying a customer's bank account needs its IBAN again. It is on file, encrypted
  // on the account it resolved to, so a person pressing "verify again" is not asked to
  // type it a second time. A new IBAN typed into the form wins.
  let inputs = input.inputs;
  const wantsIban = selected.some((check) => check.requiredInputs.includes('iban'));
  if (wantsIban && !inputs?.iban && entityId !== null) {
    const iban = await deps.inTenant((tx) => latestAccountIban(tx, deps.keys, entityId as string));
    if (iban) {
      inputs = { ...inputs, iban };
    }
  }

  for (const check of selected) {
    if (check.availability !== 'AVAILABLE') {
      outcomes.push({
        productCode: check.productCode,
        status: 'SKIPPED',
        reference: null,
        noteAr: 'هذه العملية قادمة قريباً ولم تُفعَّل بعد.',
      });
      continue;
    }

    const kind =
      entityId === null ? null : await deps.inTenant((tx) => knownKind(tx, entityId as string));
    if (kind !== null && !check.appliesTo.includes(kind)) {
      outcomes.push({
        productCode: check.productCode,
        status: 'SKIPPED',
        reference: null,
        noteAr:
          kind === 'ESTABLISHMENT'
            ? 'المؤسسة الفردية لا تملك عقد تأسيس، فلم تُنفَّذ العملية ولم تُحتسب.'
            : 'لا تنطبق هذه العملية على هذا العميل.',
      });
      continue;
    }

    const subject = subjectFor(check, input.kind, identity, inputs);
    const missing = check.requiredInputs.filter(
      (name) => name !== 'manager_id' && subject[name] === undefined,
    );
    if (missing.length > 0) {
      outcomes.push({
        productCode: check.productCode,
        status: 'SKIPPED',
        reference: null,
        noteAr: missing.includes('iban')
          ? 'أدخل رقم الآيبان لتنفيذ هذه العملية.'
          : 'بيانات ناقصة لتنفيذ هذه العملية.',
      });
      continue;
    }

    // A manager check is one call per manager, for the managers the registry named.
    const targets = check.requiredInputs.includes('manager_id')
      ? entityId === null
        ? []
        : (
            await deps.inTenant((tx) => managersOf(tx, deps.keys, entityId as string, managerLimit))
          ).filter(
            (manager) =>
              input.onlyPeople === undefined || input.onlyPeople.includes(manager.personId),
          )
      : [null];

    if (targets.length === 0) {
      outcomes.push({
        productCode: check.productCode,
        status: 'SKIPPED',
        reference: null,
        noteAr: 'لا يوجد مدراء معروفون بعد. تحقق من السجل التجاري أولاً ليُعرف المدراء.',
      });
      continue;
    }

    for (const target of targets) {
      const idempotencyKey = `${input.bundleKey}:${check.productCode}${target ? `:${target.personId}` : ''}`;
      try {
        const result = await deps.inTenant((tx) =>
          verify(tx, {
            productCode: check.productCode,
            subject: target ? { ...subject, manager_id: target.id } : subject,
            subjectIdentifiers: identifiersOf(input.kind, identity),
            idempotencyKey,
            triggeredBy: 'CONSOLE',
            requestedBy: input.requestedBy,
            bundleKey: input.bundleKey,
            runStep: deps.runStepFor(tx),
            keys: deps.keys,
          }),
        );
        entityId = result.entityId ?? entityId;
        outcomes.push({
          productCode: check.productCode,
          status: result.status as CheckStatus,
          reference: result.reference,
          noteAr:
            result.status === 'NOT_FOUND'
              ? 'لا توجد بيانات لدى الجهة الرسمية لهذا المدخل.'
              : result.status === 'ERROR'
                ? 'تعذّر الوصول إلى الجهة الرسمية الآن. لم تُحتسب العملية، ويمكن إعادة المحاولة.'
                : null,
          ...(target ? { personEntityId: target.personId } : {}),
        });
      } catch (error) {
        outcomes.push({
          productCode: check.productCode,
          status: 'REFUSED',
          reference: null,
          noteAr: refusalFor(error),
          ...(target ? { personEntityId: target.personId } : {}),
        });
      }
    }
  }

  return { entityId, outcomes };
}

/** The runs of one verification started together, for the result banner. */
export async function listBundleRuns(
  tx: TenantTransaction,
  bundleKey: string,
): Promise<{ productCode: string; status: string; reference: string | null; createdAt: Date }[]> {
  const { rows } = await tx.query<{
    product_code: string;
    status: string;
    reference: string | null;
    created_at: Date;
  }>(
    `SELECT product_code, status, reference, created_at FROM verification_runs
     WHERE tenant_id = $1 AND bundle_key = $2
     ORDER BY created_at`,
    [tx.tenantId, bundleKey],
  );
  return rows.map((row) => ({
    productCode: row.product_code,
    status: row.status,
    reference: row.reference,
    createdAt: row.created_at,
  }));
}
