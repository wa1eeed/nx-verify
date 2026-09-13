import type { TenantTransaction } from '@nx-verify/db';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import { getEntity, type EntityType } from '../repositories/entities.js';
import { getEntityProfile, type Freshness, type ProfileField } from '../repositories/profile.js';
import { listIdentifiers } from '../repositories/identifiers.js';
import {
  fieldGroup,
  fieldLabelAr,
  isHiddenField,
  valueLabelAr,
  type FieldGroup,
} from '../profile/field-catalogue.js';
import { checksFor, listChecks, type CheckDefinition, type CustomerKind, type ProfileSection } from './checks.js';
import { assessCustomer, type Assessment, type FactView } from './indicators.js';

/**
 * A customer's file, as the owner described it.
 *
 * Sections in the order a person reads a company: its registration, its articles, the
 * people who may act for it, where it is, and how it is paid. Each section lists the facts
 * it holds with their authority and the moment they were observed, says whether they are
 * current, and names the checks that fill it, so a verify button can sit beside it.
 *
 * Around the sections sit three things a list of facts cannot show on its own: the
 * classification (company, sole establishment, freelancer) from the registry's own answer,
 * the KYB or KYC indicators with the reason for each, and the links to this subscriber's
 * other customers that the facts reveal: a manager they share, an IBAN presented twice, an
 * address five establishments registered.
 *
 * Every query here is scoped to one subscriber (rule 2). A link to another subscriber's
 * customer cannot be found because it cannot be read, and that is the whole guarantee.
 */

export const SECTION_TITLES: Readonly<Record<ProfileSection, string>> = {
  REGISTRY: 'البيانات الأساسية',
  CONTRACT: 'عقد التأسيس',
  MANAGERS: 'المدراء المفوّضون',
  ADDRESS: 'العنوان الوطني',
  BANKING: 'المعلومات المصرفية',
  FREELANCE: 'وثيقة العمل الحر',
  PROPERTY: 'العقارات',
};

const SECTION_OF_GROUP: Readonly<Record<FieldGroup, ProfileSection | null>> = {
  REGISTRY: 'REGISTRY',
  CONTRACT: 'CONTRACT',
  OWNERSHIP: 'CONTRACT',
  GOVERNANCE: 'MANAGERS',
  ADDRESS: 'ADDRESS',
  BANKING: 'BANKING',
  INCOME: 'BANKING',
  FREELANCE: 'FREELANCE',
  PROPERTY: 'PROPERTY',
  OTHER: null,
};

const SECTION_ORDER: readonly ProfileSection[] = ['REGISTRY', 'FREELANCE', 'CONTRACT', 'MANAGERS', 'ADDRESS', 'BANKING', 'PROPERTY'];

export const KIND_LABELS: Readonly<Record<CustomerKind, string>> = {
  COMPANY: 'شركة',
  ESTABLISHMENT: 'مؤسسة',
  FREELANCER: 'عامل حر',
};

export interface FileField {
  fieldPath: string;
  labelAr: string;
  value: unknown;
  /** The words for the value when the authority answered in its own vocabulary. */
  valueLabelAr: string | null;
  authority: string | null;
  observedAt: Date;
  effectiveUntil: Date | null;
  freshness: Freshness;
  /** A change was detected on this field and nobody has acknowledged it yet. */
  changed: boolean;
}

export type SectionState = 'VERIFIED' | 'EXPIRING' | 'EXPIRED' | 'CHANGED' | 'NOT_VERIFIED' | 'NOT_FOUND' | 'FAILED';

export interface LastRun {
  productCode: string;
  status: string;
  reference: string | null;
  at: Date;
}

export interface FileSection {
  section: ProfileSection;
  titleAr: string;
  /** The checks that fill this section, in order. */
  checks: CheckDefinition[];
  fields: FileField[];
  state: SectionState;
  lastRun: LastRun | null;
}

export interface LinkedEntity {
  entityId: string;
  name: string | null;
  entityType: string;
}

export interface Permission {
  name: string | null;
  method: string | null;
  canIssuePoa: boolean | null;
  canDelegate: boolean | null;
  condition: string | null;
}

export interface ManagerView {
  entityId: string;
  name: string | null;
  maskedId: string | null;
  nationality: string | null;
  positions: string[];
  permissions: Permission[] | null;
  permissionsCheckedAt: Date | null;
  observedAt: Date | null;
  /** The same person's other companies among this subscriber's customers. */
  alsoManages: LinkedEntity[];
  /** True when this person is also one of the subscriber's customers in their own right. */
  isCustomer: boolean;
}

export interface PartnerView {
  entityId: string;
  name: string | null;
  kind: 'PERSON' | 'BUSINESS';
  maskedId: string | null;
  roles: string[];
  shares: number | null;
  profitPct: number | null;
  alsoOwns: LinkedEntity[];
}

export interface AccountView {
  entityId: string;
  maskedIban: string | null;
  bank: string | null;
  ownership: string | null;
  checkedAt: Date | null;
  sharedWith: LinkedEntity[];
}

export type IntersectionKind =
  | 'SHARED_MANAGER'
  | 'SHARED_PARTNER'
  | 'SHARED_ACCOUNT'
  | 'SHARED_ADDRESS'
  | 'MANAGER_IS_CUSTOMER'
  | 'MANAGES'
  | 'PARTNER_IN';

export interface Intersection {
  kind: IntersectionKind;
  textAr: string;
  /** Who or what the link runs through: a manager, an account. Null for an address. */
  via: LinkedEntity | null;
  entities: LinkedEntity[];
}

export interface CustomerFile {
  entityId: string;
  entityType: EntityType;
  displayName: string | null;
  kind: CustomerKind | null;
  kindLabelAr: string;
  identifiers: { idType: string; masked: string; isPrimary: boolean }[];
  status: { textAr: string | null; tone: 'fresh' | 'critical' | 'neutral' };
  sections: FileSection[];
  managers: ManagerView[];
  partners: PartnerView[];
  accounts: AccountView[];
  assessment: Assessment;
  intersections: Intersection[];
  lastVerifiedAt: Date | null;
  /** The soonest a current fact on this file stops being current. */
  nextReviewAt: Date | null;
  /** Share of the applicable indicators that pass, 0 to 100. */
  completeness: number;
  openChanges: number;
  /** Checks this customer is offered, whether or not they have run. */
  checks: CheckDefinition[];
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function asPermissions(value: unknown): Permission[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object')
    .map((entry) => ({
      name: typeof entry['name'] === 'string' ? entry['name'] : null,
      method: typeof entry['method'] === 'string' ? entry['method'] : null,
      canIssuePoa: typeof entry['can_issue_poa'] === 'boolean' ? entry['can_issue_poa'] : null,
      canDelegate: typeof entry['can_delegate'] === 'boolean' ? entry['can_delegate'] : null,
      condition: typeof entry['condition'] === 'string' ? entry['condition'] : null,
    }));
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function kindOf(entityType: EntityType, profile: readonly ProfileField[]): CustomerKind | null {
  if (entityType === 'FREELANCER') {
    return 'FREELANCER';
  }
  if (entityType !== 'BUSINESS') {
    return null;
  }
  const kind = profile.find((field) => field.fieldPath === 'cr.kind')?.value;
  return kind === 'COMPANY' || kind === 'ESTABLISHMENT' ? kind : null;
}

function sectionState(fields: readonly FileField[], lastRun: LastRun | null): SectionState {
  if (fields.length === 0) {
    if (lastRun?.status === 'NOT_FOUND') {
      return 'NOT_FOUND';
    }
    if (lastRun?.status === 'ERROR') {
      return 'FAILED';
    }
    return 'NOT_VERIFIED';
  }
  if (fields.some((field) => field.changed)) {
    return 'CHANGED';
  }
  if (fields.some((field) => field.freshness === 'expired')) {
    return 'EXPIRED';
  }
  if (fields.some((field) => field.freshness === 'expiring')) {
    return 'EXPIRING';
  }
  return 'VERIFIED';
}

interface RelationRow {
  other: string;
  rel_type: string;
  direction: 'out' | 'in';
  name: string | null;
  entity_type: string;
}

async function relationsOf(tx: TenantTransaction, entityId: string): Promise<RelationRow[]> {
  const { rows } = await tx.query<RelationRow>(
    `SELECT r.to_entity AS other, r.rel_type, 'out' AS direction, e.display_name AS name, e.entity_type
     FROM entity_relations r
     JOIN entities e ON e.tenant_id = r.tenant_id AND e.id = r.to_entity
     WHERE r.tenant_id = $1 AND r.from_entity = $2 AND r.ended_at IS NULL
     UNION
     SELECT r.from_entity AS other, r.rel_type, 'in' AS direction, e.display_name AS name, e.entity_type
     FROM entity_relations r
     JOIN entities e ON e.tenant_id = r.tenant_id AND e.id = r.from_entity
     WHERE r.tenant_id = $1 AND r.to_entity = $2 AND r.ended_at IS NULL`,
    [tx.tenantId, entityId],
  );
  return rows;
}

/** The other customers linked to each of these entities by a relation of this type. */
async function coLinked(
  tx: TenantTransaction,
  relType: string,
  targets: readonly string[],
  excluding: string,
): Promise<Map<string, LinkedEntity[]>> {
  const result = new Map<string, LinkedEntity[]>();
  if (targets.length === 0) {
    return result;
  }
  const { rows } = await tx.query<{ target: string; entity_id: string; name: string | null; entity_type: string }>(
    `SELECT r.to_entity AS target, e.id AS entity_id, e.display_name AS name, e.entity_type
     FROM entity_relations r
     JOIN entities e ON e.tenant_id = r.tenant_id AND e.id = r.from_entity
     WHERE r.tenant_id = $1 AND r.rel_type = $2 AND r.to_entity = ANY($3::uuid[])
       AND r.from_entity <> $4 AND r.ended_at IS NULL
     ORDER BY e.display_name`,
    [tx.tenantId, relType, [...targets], excluding],
  );
  for (const row of rows) {
    const list = result.get(row.target) ?? [];
    if (!list.some((entry) => entry.entityId === row.entity_id)) {
      list.push({ entityId: row.entity_id, name: row.name, entityType: row.entity_type });
    }
    result.set(row.target, list);
  }
  return result;
}

async function profilesOf(
  tx: TenantTransaction,
  entityIds: readonly string[],
): Promise<Map<string, Map<string, { value: unknown; observedAt: Date }>>> {
  const result = new Map<string, Map<string, { value: unknown; observedAt: Date }>>();
  if (entityIds.length === 0) {
    return result;
  }
  const { rows } = await tx.query<{ entity_id: string; field_path: string; value: unknown; observed_at: Date }>(
    `SELECT entity_id, field_path, value, observed_at FROM entity_profile
     WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])`,
    [tx.tenantId, [...entityIds]],
  );
  for (const row of rows) {
    const fields = result.get(row.entity_id) ?? new Map<string, { value: unknown; observedAt: Date }>();
    fields.set(row.field_path, { value: row.value, observedAt: row.observed_at });
    result.set(row.entity_id, fields);
  }
  return result;
}

async function maskedPrimary(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  entityId: string,
  types: readonly string[],
): Promise<string | null> {
  const identifiers = await listIdentifiers(tx, keys, entityId);
  return identifiers.find((identifier) => types.includes(identifier.idType))?.masked ?? null;
}

export async function getCustomerFile(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  entityId: string,
  options: { now?: Date } = {},
): Promise<CustomerFile | null> {
  const now = options.now ?? new Date();
  const entity = await getEntity(tx, entityId);
  if (!entity) {
    return null;
  }

  const profile = await getEntityProfile(tx, entityId);
  const identifiers = await listIdentifiers(tx, keys, entityId);
  const catalogue = await listChecks(tx);
  const kind = kindOf(entity.entityType, profile);
  const isFreelancer = entity.entityType === 'FREELANCER';
  const offered =
    isFreelancer ? checksFor(catalogue, 'FREELANCER') : entity.entityType === 'BUSINESS' ? checksFor(catalogue, kind ?? 'BUSINESS') : [];

  const { rows: runRows } = await tx.query<{ product_code: string; status: string; reference: string | null; created_at: Date }>(
    `SELECT DISTINCT ON (product_code) product_code, status, reference, created_at
     FROM verification_runs
     WHERE tenant_id = $1 AND entity_id = $2
     ORDER BY product_code, created_at DESC`,
    [tx.tenantId, entityId],
  );
  const lastRuns = new Map(
    runRows.map((row) => [row.product_code, { productCode: row.product_code, status: row.status, reference: row.reference, at: row.created_at }]),
  );

  const { rows: changeRows } = await tx.query<{ field_path: string }>(
    `SELECT DISTINCT field_path FROM change_events
     WHERE tenant_id = $1 AND entity_id = $2 AND acknowledged_at IS NULL`,
    [tx.tenantId, entityId],
  );
  const changedPaths = new Set(changeRows.map((row) => row.field_path));

  const fields: FileField[] = profile
    .filter((field) => !isHiddenField(field.fieldPath))
    .map((field) => ({
      fieldPath: field.fieldPath,
      labelAr: fieldLabelAr(field.fieldPath),
      value: field.value,
      valueLabelAr: valueLabelAr(field.fieldPath, field.value),
      authority: field.authority,
      observedAt: field.observedAt,
      effectiveUntil: field.effectiveUntil,
      freshness: field.freshness,
      changed: changedPaths.has(field.fieldPath),
    }));

  const sectionsPresent = new Set<ProfileSection>([
    ...offered.map((check) => check.section),
    ...fields.map((field) => SECTION_OF_GROUP[fieldGroup(field.fieldPath)]).filter((section): section is ProfileSection => section !== null),
  ]);

  const sections: FileSection[] = SECTION_ORDER.filter((section) => sectionsPresent.has(section)).map((section) => {
    const sectionChecks = offered.filter((check) => check.section === section);
    const sectionFields = fields.filter((field) => SECTION_OF_GROUP[fieldGroup(field.fieldPath)] === section);
    const lastRun =
      sectionChecks
        .map((check) => lastRuns.get(check.productCode))
        .filter((run): run is LastRun => run !== undefined)
        .sort((left, right) => right.at.getTime() - left.at.getTime())[0] ?? null;
    return {
      section,
      titleAr: SECTION_TITLES[section],
      checks: sectionChecks,
      fields: sectionFields,
      state: sectionState(sectionFields, lastRun),
      lastRun,
    };
  });

  // The people and accounts around this customer, and the other customers they lead to.
  const relations = await relationsOf(tx, entityId);
  const managerIds = relations.filter((row) => row.rel_type === 'MANAGES' && row.direction === 'out').map((row) => row.other);
  const partnerRows = relations.filter((row) => row.rel_type === 'OWNS' && row.direction === 'out');
  const accountIds = relations.filter((row) => row.rel_type === 'HOLDS_ACCOUNT' && row.direction === 'out').map((row) => row.other);

  const related = await profilesOf(tx, [...new Set([...managerIds, ...partnerRows.map((row) => row.other), ...accountIds])]);
  const sharedManagers = await coLinked(tx, 'MANAGES', managerIds, entityId);
  const sharedPartners = await coLinked(tx, 'OWNS', partnerRows.map((row) => row.other), entityId);
  const sharedAccounts = await coLinked(tx, 'HOLDS_ACCOUNT', accountIds, entityId);

  const managers: ManagerView[] = [];
  for (const row of relations.filter((relation) => relation.rel_type === 'MANAGES' && relation.direction === 'out')) {
    const facts = related.get(row.other) ?? new Map<string, { value: unknown; observedAt: Date }>();
    const permissions = facts.get(`manager.permissions.${entityId}`);
    managers.push({
      entityId: row.other,
      name: (facts.get('person.name')?.value as string | undefined) ?? row.name,
      maskedId: await maskedPrimary(tx, keys, row.other, ['NATIONAL_ID', 'IQAMA']),
      nationality: (facts.get('person.nationality')?.value as string | undefined) ?? null,
      positions: asStrings(facts.get(`manager.positions.${entityId}`)?.value),
      permissions: permissions ? asPermissions(permissions.value) : null,
      permissionsCheckedAt: permissions?.observedAt ?? null,
      observedAt: facts.get(`manager.positions.${entityId}`)?.observedAt ?? facts.get('person.name')?.observedAt ?? null,
      alsoManages: (sharedManagers.get(row.other) ?? []).filter((entry) => entry.entityType === 'BUSINESS'),
      isCustomer: row.entity_type === 'FREELANCER',
    });
  }

  const partners: PartnerView[] = [];
  for (const row of partnerRows) {
    const facts = related.get(row.other) ?? new Map<string, { value: unknown; observedAt: Date }>();
    const isBusiness = row.entity_type === 'BUSINESS';
    partners.push({
      entityId: row.other,
      name: row.name,
      kind: isBusiness ? 'BUSINESS' : 'PERSON',
      maskedId: await maskedPrimary(tx, keys, row.other, isBusiness ? ['CR', 'UNN'] : ['NATIONAL_ID', 'IQAMA']),
      roles: asStrings(facts.get(`partner.roles.${entityId}`)?.value),
      shares: numberOrNull(facts.get(`partner.shares.${entityId}`)?.value),
      profitPct: numberOrNull(facts.get(`partner.profit_pct.${entityId}`)?.value),
      alsoOwns: sharedPartners.get(row.other) ?? [],
    });
  }

  const accounts: AccountView[] = [];
  for (const accountId of accountIds) {
    const facts = related.get(accountId) ?? new Map<string, { value: unknown; observedAt: Date }>();
    const ownership = facts.get(`account.ownership.${entityId}`);
    accounts.push({
      entityId: accountId,
      maskedIban: await maskedPrimary(tx, keys, accountId, ['IBAN']),
      bank: (facts.get('account.bank')?.value as string | undefined) ?? null,
      ownership: typeof ownership?.value === 'string' ? ownership.value : null,
      checkedAt: ownership?.observedAt ?? null,
      sharedWith: sharedAccounts.get(accountId) ?? [],
    });
  }

  // An address is not a relation: it is the same fact recorded on two files.
  const addressKey = profile.find((field) => field.fieldPath === 'address.national.key')?.value;
  const { rows: addressRows } =
    addressKey === undefined
      ? { rows: [] as { entity_id: string; name: string | null; entity_type: string }[] }
      : await tx.query<{ entity_id: string; name: string | null; entity_type: string }>(
          `SELECT p.entity_id, e.display_name AS name, e.entity_type
           FROM entity_profile p
           JOIN entities e ON e.tenant_id = p.tenant_id AND e.id = p.entity_id
           WHERE p.tenant_id = $1 AND p.field_path = 'address.national.key'
             AND p.value = $2::jsonb AND p.entity_id <> $3
           ORDER BY e.display_name`,
          [tx.tenantId, JSON.stringify(addressKey), entityId],
        );

  const intersections: Intersection[] = [];
  for (const manager of managers) {
    if (manager.alsoManages.length > 0) {
      intersections.push({
        kind: 'SHARED_MANAGER',
        textAr: `${manager.name ?? 'أحد المدراء'} يدير ${manager.alsoManages.length === 1 ? 'منشأة أخرى' : `${manager.alsoManages.length} منشآت أخرى`} من عملائك`,
        via: { entityId: manager.entityId, name: manager.name, entityType: 'PERSON' },
        entities: manager.alsoManages,
      });
    }
    if (manager.isCustomer) {
      intersections.push({
        kind: 'MANAGER_IS_CUSTOMER',
        textAr: `${manager.name ?? 'أحد المدراء'} عميل لديك كعامل حر`,
        via: null,
        entities: [{ entityId: manager.entityId, name: manager.name, entityType: 'FREELANCER' }],
      });
    }
  }
  for (const partner of partners) {
    if (partner.alsoOwns.length > 0) {
      intersections.push({
        kind: 'SHARED_PARTNER',
        textAr: `${partner.name ?? 'أحد الشركاء'} شريك أيضاً في ${partner.alsoOwns.length === 1 ? 'منشأة أخرى' : `${partner.alsoOwns.length} منشآت أخرى`} من عملائك`,
        via: { entityId: partner.entityId, name: partner.name, entityType: partner.kind },
        entities: partner.alsoOwns,
      });
    }
  }
  for (const account of accounts) {
    if (account.sharedWith.length > 0) {
      intersections.push({
        kind: 'SHARED_ACCOUNT',
        textAr: `الحساب البنكي ${account.maskedIban ?? ''} مقدَّم أيضاً لـ${account.sharedWith.length === 1 ? 'عميل آخر' : `${account.sharedWith.length} عملاء آخرين`}`,
        via: { entityId: account.entityId, name: account.maskedIban, entityType: 'BANK_ACCOUNT' },
        entities: account.sharedWith,
      });
    }
  }
  if (addressRows.length > 0) {
    intersections.push({
      kind: 'SHARED_ADDRESS',
      textAr: `العنوان الوطني نفسه مسجل لـ${addressRows.length === 1 ? 'منشأة أخرى' : `${addressRows.length} منشآت أخرى`} من عملائك`,
      via: null,
      entities: addressRows.map((row) => ({ entityId: row.entity_id, name: row.name, entityType: row.entity_type })),
    });
  }
  // A person's own file: the companies they act for, from those companies' records.
  const managesIn = relations.filter((row) => row.rel_type === 'MANAGES' && row.direction === 'in');
  if (managesIn.length > 0) {
    intersections.push({
      kind: 'MANAGES',
      textAr: `مدير في ${managesIn.length === 1 ? 'منشأة' : `${managesIn.length} منشآت`} من عملائك`,
      via: null,
      entities: managesIn.map((row) => ({ entityId: row.other, name: row.name, entityType: row.entity_type })),
    });
  }
  const ownsIn = relations.filter((row) => row.rel_type === 'OWNS' && row.direction === 'in');
  if (ownsIn.length > 0) {
    intersections.push({
      kind: 'PARTNER_IN',
      textAr: `شريك في ${ownsIn.length === 1 ? 'منشأة' : `${ownsIn.length} منشآت`} من عملائك`,
      via: null,
      entities: ownsIn.map((row) => ({ entityId: row.other, name: row.name, entityType: row.entity_type })),
    });
  }

  const facts = new Map<string, FactView>(
    profile.map((field) => [field.fieldPath, { value: field.value, freshness: field.freshness, observedAt: field.observedAt }]),
  );
  const assessment = assessCustomer({
    kind,
    isFreelancer,
    facts,
    managers: managers.map((manager) => ({
      name: manager.name,
      hasPermissions: manager.permissions !== null,
      otherCompanies: manager.alsoManages.length,
    })),
    accountsSharedWith: accounts.reduce((sum, account) => sum + account.sharedWith.length, 0),
    addressSharedWith: addressRows.length,
    openChanges: changedPaths.size,
    now,
  });

  const statusCode = facts.get('cr.status_code')?.value;
  const statusText = facts.get('cr.status')?.value;
  const certificate = facts.get('freelance.certificate_status');
  const status = isFreelancer
    ? {
        textAr: certificate ? (valueLabelAr('freelance.certificate_status', certificate.value) ?? String(certificate.value)) : null,
        tone: certificate === undefined ? ('neutral' as const) : certificate.value === 'ACTIVE' ? ('fresh' as const) : ('critical' as const),
      }
    : {
        textAr: typeof statusText === 'string' ? statusText : null,
        tone: statusCode === undefined ? ('neutral' as const) : statusCode === 1 ? ('fresh' as const) : ('critical' as const),
      };

  const lastVerifiedAt = profile.reduce<Date | null>(
    (latest, field) => (latest === null || field.observedAt > latest ? field.observedAt : latest),
    null,
  );
  const nextReviewAt = profile
    .filter((field) => field.effectiveUntil !== null && field.freshness !== 'permanent')
    .reduce<Date | null>(
      (soonest, field) => (field.effectiveUntil !== null && (soonest === null || field.effectiveUntil < soonest) ? field.effectiveUntil : soonest),
      null,
    );

  return {
    entityId,
    entityType: entity.entityType,
    displayName: entity.displayName,
    kind,
    kindLabelAr: kind ? KIND_LABELS[kind] : entity.entityType === 'BUSINESS' ? 'منشأة' : entity.entityType === 'PERSON' ? 'شخص' : 'حساب',
    identifiers: identifiers.map((identifier) => ({ idType: identifier.idType, masked: identifier.masked, isPrimary: identifier.isPrimary })),
    status,
    sections,
    managers,
    partners,
    accounts,
    assessment,
    intersections,
    lastVerifiedAt,
    nextReviewAt,
    completeness: assessment.applicable === 0 ? 0 : Math.round((assessment.passed / assessment.applicable) * 100),
    openChanges: changedPaths.size,
    checks: offered,
  };
}
