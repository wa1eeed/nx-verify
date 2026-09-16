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
  | 'REGISTRY'
  | 'CONTRACT'
  | 'MANAGERS'
  | 'ADDRESS'
  | 'BANKING'
  | 'FREELANCE'
  | 'PROPERTY'
  | 'INCOME';

export interface CheckDefinition {
  productCode: string;
  nameAr: string;
  nameEn: string;
  /** What the check brings back, in a line. Null for a product that does not say. */
  summaryAr: string | null;
  section: ProfileSection;
  /** The module that sells it, which is the switch a subscriber is given or refused. */
  moduleCode: string;
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
    name_en: string;
    summary_ar: string | null;
    profile_section: ProfileSection;
    applies_to: CustomerKind[];
    check_order: number;
    availability: 'AVAILABLE' | 'COMING_SOON';
    input_schema: { required?: string[]; properties?: Record<string, unknown> };
    module_code: string;
  }>(
    /**
     * What this workspace may actually use.
     *
     * A service switched off for one subscriber disappears from their screens entirely: no
     * section in a customer file, no tick box on a request, nothing counted as missing. Showing
     * a section that can never be filled is a file that looks permanently incomplete, and the
     * refusal would only arrive after somebody pressed the button.
     *
     * The precedence runs from the most specific decision to the least (ADR-137): an exception
     * written for one product, then the module switched for this subscriber, then what their
     * plan sells, then what the module is worth to somebody nobody has decided about. A core
     * module answers yes whatever anybody wrote, because the file cannot be drawn without it.
     */
    `SELECT p.code, p.name_ar, p.name_en, p.summary_ar, p.profile_section, p.applies_to,
            p.check_order, p.availability, p.input_schema, p.module_code
     FROM products p
     JOIN modules m ON m.code = p.module_code AND m.status = 'active'
     LEFT JOIN tenant_modules tm
       ON tm.tenant_id = nullif($1, '')::uuid AND tm.module_code = p.module_code
     LEFT JOIN tenant_product_overrides o
       ON o.tenant_id = nullif($1, '')::uuid AND o.product_code = p.code
     LEFT JOIN tenant_commitments t ON t.tenant_id = nullif($1, '')::uuid
     LEFT JOIN package_products pp
       ON pp.package_code = t.package_code AND pp.product_code = p.code
     WHERE p.profile_section IS NOT NULL AND p.status = 'active'
       AND p.valid_from <= now() AND (p.valid_to IS NULL OR p.valid_to > now())
       AND (CASE WHEN m.core THEN true
                 ELSE COALESCE(o.enabled, tm.enabled, pp.enabled, m.default_on) END) = true
     ORDER BY p.check_order, p.code`,
    [tx.tenantId ?? ''],
  );

  return rows.map((row) => ({
    productCode: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    summaryAr: row.summary_ar,
    section: row.profile_section,
    moduleCode: row.module_code,
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
  /** Leave these managers out: their check in this verification has already settled. */
  skipPeople?: readonly string[];
  /**
   * Which attempt of the verification this is, from 1.
   *
   * A call that could not reach the authority is recorded with its key, so asking again
   * under the same key only replays the failure. A later attempt gets keys of its own,
   * derived from the same bundle, and is still one verification in the log.
   */
  attempt?: number;
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

/**
 * A certificate number as the authority expects it: «FL-013988291».
 *
 * Identifiers are normalised before they are hashed and sealed, and normalising drops the
 * dash, so a number read back from the file comes out as «FL013988291» and would be refused
 * by the product's schema. Put back here, where it is sent, and nowhere else.
 */
export function certificateForCall(value: string): string {
  const compact = value.replace(/[\s-]/g, '').toUpperCase();
  return /^FL[0-9]+$/.test(compact) ? `FL-${compact.slice(2)}` : compact;
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
    ...(certificate ? { certificateNumber: certificateForCall(certificate.value) } : {}),
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
              (input.onlyPeople === undefined || input.onlyPeople.includes(manager.personId)) &&
              !(input.skipPeople ?? []).includes(manager.personId),
          )
      : [null];

    if (targets.length === 0 && (input.skipPeople ?? []).length > 0) {
      // Every manager left to check has already settled in an earlier attempt.
      continue;
    }
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
      const idempotencyKey = checkKey(
        input.bundleKey,
        input.attempt ?? 1,
        check.productCode,
        target?.personId,
      );
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

/** The idempotency key of one call of a verification: the bundle, the attempt, the check, the person. */
function checkKey(
  bundleKey: string,
  attempt: number,
  productCode: string,
  personId: string | undefined,
): string {
  const base = attempt > 1 ? `${bundleKey}~r${attempt}` : bundleKey;
  return `${base}:${productCode}${personId === undefined ? '' : `:${personId}`}`;
}

/**
 * The managers whose check has already settled in a verification, with how it ended.
 *
 * Read from the keys of the runs, which carry the person (see checkKey). A retry of a
 * manager check leaves these out: their calls reached the authority and were charged, and
 * asking again under a new key would charge them twice. Only a call that failed to reach
 * it is asked again.
 */
export async function settledPeople(
  tx: TenantTransaction,
  bundleKey: string,
  productCode: string,
): Promise<Map<string, { status: CheckStatus; reference: string | null }>> {
  const { rows } = await tx.query<{
    idempotency_key: string | null;
    status: string;
    reference: string | null;
  }>(
    `SELECT idempotency_key, status, reference FROM verification_runs
     WHERE tenant_id = $1 AND bundle_key = $2 AND product_code = $3
       AND status NOT IN ('ERROR', 'PENDING')
     ORDER BY created_at`,
    [tx.tenantId, bundleKey, productCode],
  );
  const settled = new Map<string, { status: CheckStatus; reference: string | null }>();
  for (const row of rows) {
    const person = row.idempotency_key?.split(`:${productCode}:`)[1];
    if (person !== undefined && person !== '') {
      settled.set(person, { status: row.status as CheckStatus, reference: row.reference });
    }
  }
  return settled;
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
