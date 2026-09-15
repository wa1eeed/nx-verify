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
import {
  checksFor,
  listChecks,
  type CheckDefinition,
  type CustomerKind,
  type ProfileSection,
} from './checks.js';
import { assessCustomer, type Assessment, type FactView, type Indicator } from './indicators.js';
import {
  DEFAULT_PLATFORM_SETTINGS,
  getPlatformSettings,
  layoutsOf,
  listSectionRequirements,
  type Layouts,
} from '../settings/platform.js';
import { businesses, otherBusinesses, otherCustomers } from './arabic.js';

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

/** The section names of handoff screen 03, which is the approved copy. */
export const SECTION_TITLES: Readonly<Record<ProfileSection, string>> = {
  REGISTRY: 'البيانات الأساسية',
  CONTRACT: 'عقد التأسيس والملكية',
  MANAGERS: 'المدراء المفوضون',
  ADDRESS: 'العنوان الوطني',
  BANKING: 'المعلومات المصرفية',
  FREELANCE: 'شهادة العمل الحر',
  PROPERTY: 'العقارات',
};

/**
 * The line under each section's title that says which check fills it, as screen 03 words it.
 *
 * Written per section rather than composed from product names: the approved lines are
 * sentences («مصدرها تحقق المدراء المفوضين», «مصدرها تحقق الآيبان والحساب»), and gluing
 * names together reads as a list of products rather than as Arabic.
 */
export const SECTION_SOURCES: Readonly<Record<ProfileSection, string>> = {
  REGISTRY: 'مصدرها تحقق السجل التجاري',
  CONTRACT: 'مصدرها تحقق عقد التأسيس',
  MANAGERS: 'مصدرها تحقق المدراء المفوضين',
  ADDRESS: 'مصدرها تحقق العنوان الوطني',
  BANKING: 'مصدرها تحقق الآيبان والحساب',
  FREELANCE: 'مصدرها تحقق شهادة الفريلانسر',
  PROPERTY: 'مصدرها تحقق العقار',
};

export type SectionRequirement = 'REQUIRED' | 'OPTIONAL' | 'NOT_APPLICABLE';

/**
 * Which sections a file has, in order, for each kind of customer (README, screen 03).
 *
 * A company has all five. A sole establishment has no articles of association, and its
 * managers are optional. A freelancer's basic data and certificate both come from the
 * certificate check, and the national address is shown as not available: no data source
 * this product uses verifies an individual's address today (PLAN.md, decision 8). A
 * business whose registry answer has not said which kind it is gets the company's sections,
 * with the two that depend on the kind left optional.
 */
const LAYOUTS: Readonly<
  Record<CustomerKind | 'BUSINESS', readonly (readonly [ProfileSection, SectionRequirement])[]>
> = {
  COMPANY: [
    ['REGISTRY', 'REQUIRED'],
    ['CONTRACT', 'REQUIRED'],
    ['MANAGERS', 'REQUIRED'],
    ['ADDRESS', 'REQUIRED'],
    ['BANKING', 'REQUIRED'],
  ],
  ESTABLISHMENT: [
    ['REGISTRY', 'REQUIRED'],
    ['MANAGERS', 'OPTIONAL'],
    ['ADDRESS', 'REQUIRED'],
    ['BANKING', 'REQUIRED'],
  ],
  BUSINESS: [
    ['REGISTRY', 'REQUIRED'],
    ['CONTRACT', 'OPTIONAL'],
    ['MANAGERS', 'OPTIONAL'],
    ['ADDRESS', 'REQUIRED'],
    ['BANKING', 'REQUIRED'],
  ],
  FREELANCER: [
    ['REGISTRY', 'REQUIRED'],
    ['FREELANCE', 'REQUIRED'],
    ['ADDRESS', 'NOT_APPLICABLE'],
    ['BANKING', 'REQUIRED'],
  ],
};

/**
 * The layouts from the settings, with the one for a business whose kind is not known yet:
 * a company's sections, with those that depend on the kind left optional.
 */
function withBusinessLayout(
  layouts: Layouts,
): Readonly<
  Record<CustomerKind | 'BUSINESS', readonly (readonly [ProfileSection, SectionRequirement])[]>
> {
  return {
    ...layouts,
    BUSINESS: layouts.COMPANY.map(([section, requirement]) =>
      section === 'CONTRACT' || section === 'MANAGERS'
        ? ([section, requirement === 'NOT_APPLICABLE' ? requirement : 'OPTIONAL'] as const)
        : ([section, requirement] as const),
    ),
  };
}

/** The name-match share below which an account holder's name is a conflict (screen 05). */
export const NAME_MATCH_THRESHOLD_PCT = 85;

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

const SECTION_ORDER: readonly ProfileSection[] = [
  'REGISTRY',
  'FREELANCE',
  'CONTRACT',
  'MANAGERS',
  'ADDRESS',
  'BANKING',
  'PROPERTY',
];

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

export type SectionState =
  | 'VERIFIED'
  | 'EXPIRING'
  | 'EXPIRED'
  | 'CHANGED'
  /** Verified, and what was verified does not hold: a name that does not match, a registry that is not active. */
  | 'CONFLICT'
  /** Some of it verified: some managers' powers checked and some not. */
  | 'PARTIAL'
  | 'NOT_VERIFIED'
  | 'NOT_FOUND'
  | 'FAILED'
  | 'NOT_APPLICABLE';

export interface LastRun {
  productCode: string;
  status: string;
  reference: string | null;
  at: Date;
}

export interface FileSection {
  section: ProfileSection;
  /** Its place on the file, counted over the sections this kind of customer has. */
  number: number;
  titleAr: string;
  requirement: SectionRequirement;
  /** «مصدرها تحقق …», naming the checks that fill it. Null where nothing can fill it. */
  sourceAr: string | null;
  /** The checks that fill this section, in order. */
  checks: CheckDefinition[];
  fields: FileField[];
  state: SectionState;
  /** Why a section is in conflict or partly verified, in a few words. */
  issueAr: string | null;
  /** When the newest fact in the section was observed. */
  observedAt: Date | null;
  /** The authority of the section's facts, when they all share one. */
  authority: string | null;
  /** Holds what it should: verified, even if it has since changed or conflicts. */
  done: boolean;
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
  /** True when this partner has been verified in its own right, with a file of its own. */
  hasOwnFile: boolean;
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
  /** When this file was opened, which is when the customer was first seen. */
  createdAt: Date;
  identifiers: { idType: string; masked: string; display: string; isPrimary: boolean }[];
  /**
   * The number the header shows beside the name, with its short label: a business's registry
   * number in full, a person's identifier masked (ADR-127).
   */
  primaryIdentifier: { labelAr: string; masked: string; display: string } | null;
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
  /** Share of the required sections that are complete, 0 to 100. */
  completeness: number;
  sectionsDone: number;
  sectionsRequired: number;
  /** The people behind the customer and how many of them are verified. */
  kyc: { verified: number; total: number; lineAr: string };
  openChanges: number;
  /** Checks this customer is offered, whether or not they have run. */
  checks: CheckDefinition[];
  /** The name match an account needs to count as the customer's (screen 05). */
  nameMatchThresholdPct: number;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function asPermissions(value: unknown): Permission[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .filter(
      (entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object',
    )
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

const DONE_STATES: ReadonlySet<SectionState> = new Set<SectionState>([
  'VERIFIED',
  'EXPIRING',
  'CHANGED',
  'CONFLICT',
]);

interface SectionDraft {
  section: ProfileSection;
  requirement: SectionRequirement;
  fields: FileField[];
  lastRun: LastRun | null;
}

/**
 * A section's state, and the few words that say why when it is in conflict or partial.
 *
 * The order is what a reader must see first: nothing can fill it; nothing is in it yet; what
 * was verified does not hold; it changed since; it aged out; it is about to.
 */
function sectionStateOf(
  draft: SectionDraft,
  context: {
    items: ReadonlyMap<string, Indicator>;
    isFreelancer: boolean;
    managers: number;
    managersChecked: number;
    managersCheckedAt: Date | null;
    /** How early a registry about to lapse is flagged (screen 05). */
    registryAlertDays: number;
    now: Date;
  },
): { state: SectionState; issueAr: string | null } {
  if (draft.requirement === 'NOT_APPLICABLE') {
    return { state: 'NOT_APPLICABLE', issueAr: null };
  }

  if (draft.section === 'MANAGERS') {
    if (context.managers === 0 || context.managersChecked === 0) {
      return { state: 'NOT_VERIFIED', issueAr: null };
    }
    return context.managersChecked < context.managers
      ? {
          state: 'PARTIAL',
          issueAr: `${context.managersChecked} من ${context.managers}`,
        }
      : { state: 'VERIFIED', issueAr: null };
  }

  if (draft.fields.length === 0) {
    if (draft.lastRun?.status === 'NOT_FOUND') {
      return { state: 'NOT_FOUND', issueAr: null };
    }
    if (draft.lastRun?.status === 'ERROR') {
      return { state: 'FAILED', issueAr: null };
    }
    return { state: 'NOT_VERIFIED', issueAr: null };
  }

  const conflict = conflictOf(draft.section, context.items, context.isFreelancer);
  if (conflict !== null) {
    return { state: 'CONFLICT', issueAr: conflict };
  }
  if (draft.fields.some((field) => field.changed)) {
    return { state: 'CHANGED', issueAr: null };
  }
  if (draft.fields.some((field) => field.freshness === 'expired')) {
    return { state: 'EXPIRED', issueAr: null };
  }
  if (draft.fields.some((field) => field.freshness === 'expiring')) {
    return { state: 'EXPIRING', issueAr: null };
  }
  // The registry is flagged as early as the platform says (screen 05), for the facts that
  // stay current longer than that window: a status checked weekly would otherwise be flagged
  // from the day it was read.
  const window = context.registryAlertDays * 86_400_000;
  if (
    draft.section === 'REGISTRY' &&
    draft.fields.some(
      (field) =>
        field.effectiveUntil !== null &&
        field.effectiveUntil.getTime() - field.observedAt.getTime() > window &&
        field.effectiveUntil.getTime() - context.now.getTime() <= window,
    )
  ) {
    return { state: 'EXPIRING', issueAr: null };
  }
  return { state: 'VERIFIED', issueAr: null };
}

/** What makes a verified section not hold, from the indicator that watches it. */
function conflictOf(
  section: ProfileSection,
  items: ReadonlyMap<string, Indicator>,
  isFreelancer: boolean,
): string | null {
  if (section === 'REGISTRY' && !isFreelancer && items.get('registry_active')?.state === 'FAIL') {
    return items.get('registry_active')?.detailAr?.includes('التصفية')
      ? 'تحت التصفية'
      : 'السجل غير فعّال';
  }
  if (section === 'FREELANCE') {
    if (items.get('certificate_owned')?.state === 'FAIL') {
      return 'لا تعود لصاحب الهوية';
    }
    if (items.get('certificate_active')?.state === 'FAIL') {
      return 'الوثيقة غير سارية';
    }
  }
  if (section === 'BANKING') {
    const bank = items.get('bank_account');
    if (bank?.state === 'FAIL') {
      return 'الحساب باسم آخر';
    }
    if (bank?.state === 'WARN') {
      return bank.detailAr?.includes('غير نشط') ? 'الحساب غير نشط' : 'تعارض في الاسم';
    }
  }
  return null;
}

function managersLine(total: number, checked: number): string {
  if (total === 0) {
    return 'يظهر المدراء بعد التحقق من السجل التجاري';
  }
  const pending = total - checked;
  if (pending === 0) {
    return total === 1 ? 'صلاحيات المدير مثبتة' : 'صلاحيات كل المدراء مثبتة';
  }
  return pending === 1
    ? 'مدير مفوّض واحد بانتظار التحقق'
    : pending === 2
      ? 'مديران بانتظار التحقق'
      : `${pending} مدراء بانتظار التحقق`;
}

const ID_SHORT_LABELS: Readonly<Record<string, string>> = {
  CR: 'س.ت',
  UNN: 'الرقم الموحد',
  NATIONAL_ID: 'هوية',
  IQAMA: 'إقامة',
};

export function primaryIdentifierOf(
  identifiers: readonly { idType: string; masked: string; display: string; isPrimary: boolean }[],
): { labelAr: string; masked: string; display: string } | null {
  const preferred = ['CR', 'UNN', 'NATIONAL_ID', 'IQAMA']
    .map((idType) => identifiers.find((identifier) => identifier.idType === idType))
    .find((identifier) => identifier !== undefined);
  return preferred === undefined
    ? null
    : {
        labelAr: ID_SHORT_LABELS[preferred.idType] ?? preferred.idType,
        masked: preferred.masked,
        display: preferred.display,
      };
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
  const { rows } = await tx.query<{
    target: string;
    entity_id: string;
    name: string | null;
    entity_type: string;
  }>(
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
  const { rows } = await tx.query<{
    entity_id: string;
    field_path: string;
    value: unknown;
    observed_at: Date;
  }>(
    `SELECT entity_id, field_path, value, observed_at FROM entity_profile
     WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])`,
    [tx.tenantId, [...entityIds]],
  );
  for (const row of rows) {
    const fields =
      result.get(row.entity_id) ?? new Map<string, { value: unknown; observedAt: Date }>();
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

/** What deciding a file's sections, indicators and figures needs, however it was loaded. */
export interface FileBasis {
  entityType: EntityType;
  profile: readonly ProfileField[];
  /** Fields with a detected change nobody has acknowledged. */
  changedPaths: ReadonlySet<string>;
  /** The newest run of each check on this customer. */
  lastRuns: ReadonlyMap<string, LastRun>;
  managers: readonly {
    name: string | null;
    hasPermissions: boolean;
    /** Other businesses the same person manages. */
    otherCompanies: number;
    permissionsCheckedAt: Date | null;
    observedAt: Date | null;
  }[];
  /** Other entities holding the accounts this customer holds. */
  accountsSharedWith: number;
  /** Other entities registered at the same national address. */
  addressSharedWith: number;
  catalogue: readonly CheckDefinition[];
  now: Date;
  /** The platform's settings (screen 05). The shipped defaults when absent. */
  settings?: { nameMatchThresholdPct: number; registryAlertDays: number } | undefined;
  /** Which sections each kind of file has, from the settings. The shipped layouts when absent. */
  layouts?: Layouts | undefined;
}

export interface FileStanding {
  kind: CustomerKind | null;
  isFreelancer: boolean;
  offered: CheckDefinition[];
  fields: FileField[];
  facts: Map<string, FactView>;
  sections: FileSection[];
  assessment: Assessment;
  completeness: number;
  sectionsDone: number;
  sectionsRequired: number;
  managersChecked: number;
}

/**
 * The sections of a file, their states, the indicators and the figures, from loaded facts.
 *
 * Pure, so the one customer file and the list of every customer decide the same things the
 * same way: a row on the list and the file it opens never disagree about how complete it is
 * or what its risk score is.
 */
export function fileStandingOf(basis: FileBasis): FileStanding {
  const { profile, changedPaths, lastRuns, catalogue } = basis;
  const kind = kindOf(basis.entityType, profile);
  const isFreelancer = basis.entityType === 'FREELANCER';
  const offered = isFreelancer
    ? checksFor(catalogue, 'FREELANCER')
    : basis.entityType === 'BUSINESS'
      ? checksFor(catalogue, kind ?? 'BUSINESS')
      : [];

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

  // Which sections this file has, in order. A customer of a known kind has its layout; a
  // related record opened on its own has the sections its facts fall in.
  const layouts = basis.layouts === undefined ? LAYOUTS : withBusinessLayout(basis.layouts);
  const layout: readonly (readonly [ProfileSection, SectionRequirement])[] = isFreelancer
    ? layouts.FREELANCER
    : basis.entityType === 'BUSINESS'
      ? layouts[kind ?? 'BUSINESS']
      : SECTION_ORDER.filter((section) =>
          fields.some((field) => SECTION_OF_GROUP[fieldGroup(field.fieldPath)] === section),
        ).map((section) => [section, 'OPTIONAL'] as const);

  // A freelancer's own particulars come from the certificate check, and read as the file's
  // basic data rather than as part of the certificate.
  const sectionOf = (field: FileField): ProfileSection | null =>
    isFreelancer && field.fieldPath.startsWith('person.')
      ? 'REGISTRY'
      : SECTION_OF_GROUP[fieldGroup(field.fieldPath)];

  const drafts = layout.map(([section, requirement], index) => {
    const sectionChecks = offered.filter(
      (check) =>
        check.section === section ||
        (isFreelancer && section === 'REGISTRY' && check.section === 'FREELANCE'),
    );
    const sectionFields =
      requirement === 'NOT_APPLICABLE'
        ? []
        : fields.filter((field) => sectionOf(field) === section);
    const lastRun =
      sectionChecks
        .map((check) => lastRuns.get(check.productCode))
        .filter((run): run is LastRun => run !== undefined)
        .sort((left, right) => right.at.getTime() - left.at.getTime())[0] ?? null;
    const authorities = [...new Set(sectionFields.map((field) => field.authority))];
    return {
      section,
      number: index + 1,
      titleAr: SECTION_TITLES[section],
      requirement,
      sourceAr:
        requirement === 'NOT_APPLICABLE' || sectionChecks.length === 0
          ? null
          : // A freelancer's basic data is filled by the certificate check.
            SECTION_SOURCES[isFreelancer && section === 'REGISTRY' ? 'FREELANCE' : section],
      checks: sectionChecks,
      fields: sectionFields,
      lastRun,
      observedAt: sectionFields.reduce<Date | null>(
        (latest, field) =>
          latest === null || field.observedAt > latest ? field.observedAt : latest,
        null,
      ),
      authority: authorities.length === 1 ? (authorities[0] ?? null) : null,
    };
  });

  const facts = new Map<string, FactView>(
    profile.map((field) => [
      field.fieldPath,
      { value: field.value, freshness: field.freshness, observedAt: field.observedAt },
    ]),
  );
  const assessmentInput = {
    kind,
    isFreelancer,
    facts,
    managers: basis.managers.map((manager) => ({
      name: manager.name,
      hasPermissions: manager.hasPermissions,
      otherCompanies: manager.otherCompanies,
    })),
    accountsSharedWith: basis.accountsSharedWith,
    addressSharedWith: basis.addressSharedWith,
    openChanges: basis.changedPaths.size,
    nameMatchThresholdPct:
      basis.settings?.nameMatchThresholdPct ?? DEFAULT_PLATFORM_SETTINGS.nameMatchThresholdPct,
    now: basis.now,
  };
  // The indicators decide which sections are in conflict, and the sections still missing
  // weigh in the risk score, so the file is assessed once for the first and again with them.
  const items = new Map(assessCustomer(assessmentInput).items.map((item) => [item.key, item]));
  const managers = basis.managers;
  const managersChecked = managers.filter((manager) => manager.hasPermissions).length;

  const sections: FileSection[] = drafts.map((draft) => {
    const { state, issueAr } = sectionStateOf(draft, {
      items,
      isFreelancer,
      managers: managers.length,
      managersChecked,
      managersCheckedAt:
        managers
          .map((manager) => manager.permissionsCheckedAt)
          .filter((at): at is Date => at !== null)
          .sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
      registryAlertDays:
        basis.settings?.registryAlertDays ?? DEFAULT_PLATFORM_SETTINGS.registryAlertDays,
      now: basis.now,
    });
    const observedAt =
      draft.section === 'MANAGERS'
        ? (managers
            .map((manager) => manager.permissionsCheckedAt ?? manager.observedAt)
            .filter((at): at is Date => at !== null)
            .sort((left, right) => right.getTime() - left.getTime())[0] ?? null)
        : draft.observedAt;
    return {
      ...draft,
      observedAt,
      state,
      issueAr,
      done: DONE_STATES.has(state),
    };
  });

  const required = sections.filter((section) => section.requirement === 'REQUIRED');
  const sectionsDone = required.filter((section) => section.done).length;
  const assessment = assessCustomer({
    ...assessmentInput,
    incompleteSections: required
      .filter((section) => !section.done)
      .map((section) => section.titleAr),
  });

  return {
    kind,
    isFreelancer,
    offered,
    fields,
    facts,
    sections,
    assessment,
    completeness: required.length === 0 ? 0 : Math.round((sectionsDone / required.length) * 100),
    sectionsDone,
    sectionsRequired: required.length,
    managersChecked,
  };
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

  const { rows: runRows } = await tx.query<{
    product_code: string;
    status: string;
    reference: string | null;
    created_at: Date;
  }>(
    `SELECT DISTINCT ON (product_code) product_code, status, reference, created_at
     FROM verification_runs
     WHERE tenant_id = $1 AND entity_id = $2
     ORDER BY product_code, created_at DESC`,
    [tx.tenantId, entityId],
  );
  const lastRuns = new Map(
    runRows.map((row) => [
      row.product_code,
      {
        productCode: row.product_code,
        status: row.status,
        reference: row.reference,
        at: row.created_at,
      },
    ]),
  );

  const { rows: changeRows } = await tx.query<{ field_path: string }>(
    `SELECT DISTINCT field_path FROM change_events
     WHERE tenant_id = $1 AND entity_id = $2 AND acknowledged_at IS NULL`,
    [tx.tenantId, entityId],
  );
  const changedPaths = new Set(changeRows.map((row) => row.field_path));

  // The people and accounts around this customer, and the other customers they lead to.
  const relations = await relationsOf(tx, entityId);
  const managerIds = relations
    .filter((row) => row.rel_type === 'MANAGES' && row.direction === 'out')
    .map((row) => row.other);
  const partnerRows = relations.filter((row) => row.rel_type === 'OWNS' && row.direction === 'out');
  const accountIds = relations
    .filter((row) => row.rel_type === 'HOLDS_ACCOUNT' && row.direction === 'out')
    .map((row) => row.other);

  const related = await profilesOf(tx, [
    ...new Set([...managerIds, ...partnerRows.map((row) => row.other), ...accountIds]),
  ]);
  const sharedManagers = await coLinked(tx, 'MANAGES', managerIds, entityId);
  const sharedPartners = await coLinked(
    tx,
    'OWNS',
    partnerRows.map((row) => row.other),
    entityId,
  );
  const sharedAccounts = await coLinked(tx, 'HOLDS_ACCOUNT', accountIds, entityId);
  const { rows: ownFileRows } =
    partnerRows.length === 0
      ? { rows: [] as { entity_id: string }[] }
      : await tx.query<{ entity_id: string }>(
          `SELECT DISTINCT entity_id FROM verification_runs
           WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])`,
          [tx.tenantId, partnerRows.map((row) => row.other)],
        );
  const withOwnFile = new Set(ownFileRows.map((row) => row.entity_id));

  const managers: ManagerView[] = [];
  for (const row of relations.filter(
    (relation) => relation.rel_type === 'MANAGES' && relation.direction === 'out',
  )) {
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
      observedAt:
        facts.get(`manager.positions.${entityId}`)?.observedAt ??
        facts.get('person.name')?.observedAt ??
        null,
      alsoManages: (sharedManagers.get(row.other) ?? []).filter(
        (entry) => entry.entityType === 'BUSINESS',
      ),
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
      maskedId: await maskedPrimary(
        tx,
        keys,
        row.other,
        isBusiness ? ['CR', 'UNN'] : ['NATIONAL_ID', 'IQAMA'],
      ),
      roles: asStrings(facts.get(`partner.roles.${entityId}`)?.value),
      shares: numberOrNull(facts.get(`partner.shares.${entityId}`)?.value),
      profitPct: numberOrNull(facts.get(`partner.profit_pct.${entityId}`)?.value),
      alsoOwns: sharedPartners.get(row.other) ?? [],
      hasOwnFile: withOwnFile.has(row.other),
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
        textAr: `${manager.name ?? 'أحد المدراء'} يدير أيضاً ${otherBusinesses(manager.alsoManages.length)} من عملائك`,
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
        textAr: `${partner.name ?? 'أحد الشركاء'} شريك أيضاً في ${otherBusinesses(partner.alsoOwns.length)} من عملائك`,
        via: { entityId: partner.entityId, name: partner.name, entityType: partner.kind },
        entities: partner.alsoOwns,
      });
    }
  }
  for (const account of accounts) {
    if (account.sharedWith.length > 0) {
      intersections.push({
        kind: 'SHARED_ACCOUNT',
        textAr: `الحساب البنكي نفسه مقدَّم أيضاً إلى ${otherCustomers(account.sharedWith.length)}`,
        via: { entityId: account.entityId, name: account.maskedIban, entityType: 'BANK_ACCOUNT' },
        entities: account.sharedWith,
      });
    }
  }
  if (addressRows.length > 0) {
    intersections.push({
      kind: 'SHARED_ADDRESS',
      textAr: `العنوان الوطني نفسه مسجل باسم ${otherBusinesses(addressRows.length)} من عملائك`,
      via: null,
      entities: addressRows.map((row) => ({
        entityId: row.entity_id,
        name: row.name,
        entityType: row.entity_type,
      })),
    });
  }
  // A person's own file: the companies they act for, from those companies' records.
  const managesIn = relations.filter((row) => row.rel_type === 'MANAGES' && row.direction === 'in');
  if (managesIn.length > 0) {
    intersections.push({
      kind: 'MANAGES',
      textAr: `مدير في ${businesses(managesIn.length)} من عملائك`,
      via: null,
      entities: managesIn.map((row) => ({
        entityId: row.other,
        name: row.name,
        entityType: row.entity_type,
      })),
    });
  }
  const ownsIn = relations.filter((row) => row.rel_type === 'OWNS' && row.direction === 'in');
  if (ownsIn.length > 0) {
    intersections.push({
      kind: 'PARTNER_IN',
      textAr: `شريك في ${businesses(ownsIn.length)} من عملائك`,
      via: null,
      entities: ownsIn.map((row) => ({
        entityId: row.other,
        name: row.name,
        entityType: row.entity_type,
      })),
    });
  }

  const settings = await getPlatformSettings(tx);
  const layouts = layoutsOf(await listSectionRequirements(tx));
  const standing = fileStandingOf({
    settings,
    layouts,
    entityType: entity.entityType,
    profile,
    changedPaths,
    lastRuns,
    managers: managers.map((manager) => ({
      name: manager.name,
      hasPermissions: manager.permissions !== null,
      otherCompanies: manager.alsoManages.length,
      permissionsCheckedAt: manager.permissionsCheckedAt,
      observedAt: manager.observedAt,
    })),
    accountsSharedWith: accounts.reduce((sum, account) => sum + account.sharedWith.length, 0),
    addressSharedWith: addressRows.length,
    catalogue,
    now,
  });
  const { kind, isFreelancer, facts, sections, assessment, managersChecked } = standing;

  const statusCode = facts.get('cr.status_code')?.value;
  const statusText = facts.get('cr.status')?.value;
  const certificate = facts.get('freelance.certificate_status');
  const status = isFreelancer
    ? {
        textAr: certificate
          ? (valueLabelAr('freelance.certificate_status', certificate.value) ??
            String(certificate.value))
          : null,
        tone:
          certificate === undefined
            ? ('neutral' as const)
            : certificate.value === 'ACTIVE'
              ? ('fresh' as const)
              : ('critical' as const),
      }
    : {
        textAr: typeof statusText === 'string' ? statusText : null,
        tone:
          statusCode === undefined
            ? ('neutral' as const)
            : statusCode === 1
              ? ('fresh' as const)
              : ('critical' as const),
      };

  const lastVerifiedAt = profile.reduce<Date | null>(
    (latest, field) => (latest === null || field.observedAt > latest ? field.observedAt : latest),
    null,
  );
  const nextReviewAt = profile
    .filter((field) => field.effectiveUntil !== null && field.freshness !== 'permanent')
    .reduce<Date | null>(
      (soonest, field) =>
        field.effectiveUntil !== null && (soonest === null || field.effectiveUntil < soonest)
          ? field.effectiveUntil
          : soonest,
      null,
    );

  return {
    entityId,
    entityType: entity.entityType,
    displayName: entity.displayName,
    kind,
    kindLabelAr: kind
      ? KIND_LABELS[kind]
      : entity.entityType === 'BUSINESS'
        ? 'منشأة'
        : entity.entityType === 'PERSON'
          ? 'شخص'
          : 'حساب',
    createdAt: entity.firstSeenAt,
    identifiers: identifiers.map((identifier) => ({
      idType: identifier.idType,
      masked: identifier.masked,
      display: identifier.display,
      isPrimary: identifier.isPrimary,
    })),
    primaryIdentifier: primaryIdentifierOf(identifiers),
    status,
    sections,
    managers,
    partners,
    accounts,
    assessment,
    intersections,
    lastVerifiedAt,
    nextReviewAt,
    completeness: standing.completeness,
    sectionsDone: standing.sectionsDone,
    sectionsRequired: standing.sectionsRequired,
    kyc: isFreelancer
      ? {
          verified: facts.get('freelance.ownership')?.value === 'VERIFIED' ? 1 : 0,
          total: 1,
          lineAr:
            facts.get('freelance.ownership') === undefined
              ? 'لم يُتحقق من ملكية الوثيقة بعد'
              : facts.get('freelance.ownership')?.value === 'VERIFIED'
                ? 'الوثيقة تعود لصاحب الهوية'
                : 'الوثيقة لا تعود لصاحب الهوية',
        }
      : {
          verified: managersChecked,
          total: managers.length,
          lineAr: managersLine(managers.length, managersChecked),
        },
    openChanges: changedPaths.size,
    checks: standing.offered,
    nameMatchThresholdPct: settings.nameMatchThresholdPct,
  };
}
