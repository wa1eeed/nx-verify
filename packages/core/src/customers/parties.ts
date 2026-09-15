import type { TenantTransaction } from '@nx-verify/db';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import { decryptIdentifier, displayIdentifier, type IdentifierType } from '../crypto/identifier.js';
import { findEntityIdByIdentifier } from '../repositories/identifiers.js';
import { businesses } from './arabic.js';
import type { IdentifierView, LinkedEntity, Permission } from './customer-file.js';

/**
 * The related parties: whoever a subscriber's customers name inside their files.
 *
 * A manager, a partner, a liquidator, the guardian who acts for a minor partner. They are not
 * customers: nobody verified them in their own right, and the list of customers rightly leaves
 * them out. But a compliance officer asks of them what they ask of a customer: who is this,
 * where else do they appear, is their authority proven, and is anything wrong with the
 * companies they stand behind. So they have a list of their own, and a file shaped for a person
 * rather than for a company (the owner's ask).
 *
 * Everything here reads one subscriber's records (rule 2): a person who manages a company for
 * two subscribers is two parties, one in each, and neither can see the other.
 */

export type PartyRole = 'MANAGER' | 'PARTNER' | 'LIQUIDATOR' | 'GUARDIAN';

/** The relation from a company to somebody, as the role they hold in it. */
const ROLE_OF_RELATION: Readonly<Record<string, PartyRole>> = {
  MANAGES: 'MANAGER',
  OWNS: 'PARTNER',
  LIQUIDATES: 'LIQUIDATOR',
  REPRESENTS: 'GUARDIAN',
};

export const PARTY_ROLE_LABELS: Readonly<Record<PartyRole, string>> = {
  MANAGER: 'مدير',
  PARTNER: 'شريك',
  LIQUIDATOR: 'مصفٍّ',
  GUARDIAN: 'ولي عن شريك',
};

/** Where a company stands, as far as it bears on the people behind it. */
export type CompanyStanding = 'ACTIVE' | 'INACTIVE' | 'LIQUIDATION' | 'UNKNOWN';

export interface PartyCompany extends LinkedEntity {
  roles: PartyRole[];
  standing: CompanyStanding;
  statusText: string | null;
  /** A company or a sole establishment, once its registry has said which. */
  kind: 'COMPANY' | 'ESTABLISHMENT' | null;
}

export interface RelatedPartySummary {
  entityId: string;
  entityType: string;
  displayName: string | null;
  /** In full, as the signed in console shows every identifier but an IBAN (ADR-128). */
  identifier: IdentifierView | null;
  nationality: string | null;
  companies: PartyCompany[];
  roleCounts: Readonly<Record<PartyRole, number>>;
  /** Of the companies they manage, how many have their powers verified, of those that can. */
  authority: { verified: number; checkable: number };
  /** A customer of this subscriber in their own right, with a verification of their own. */
  isCustomer: boolean;
  /** Companies of theirs whose registration is no longer active, or in liquidation. */
  concerns: number;
  lastSeenAt: Date;
}

const ID_SHORT_LABELS: Readonly<Record<string, string>> = {
  CR: 'س.ت',
  UNN: 'الرقم الموحد',
  NATIONAL_ID: 'هوية',
  IQAMA: 'إقامة',
  PARTY_ID: 'وثيقة',
};

const PARTY_ID_ORDER = ['NATIONAL_ID', 'IQAMA', 'PARTY_ID', 'CR', 'UNN'] as const;

interface RelationRow {
  party: string;
  rel_type: string;
  company: string;
  company_name: string | null;
  party_type: string;
  party_name: string | null;
  last_seen_at: Date;
}

/** Every open relation from a business to somebody it names, optionally for one party. */
async function partyRelations(tx: TenantTransaction, partyId?: string): Promise<RelationRow[]> {
  const { rows } = await tx.query<RelationRow>(
    `SELECT r.to_entity AS party, r.rel_type, r.from_entity AS company,
            c.display_name AS company_name, p.entity_type AS party_type,
            p.display_name AS party_name, p.last_seen_at
     FROM entity_relations r
     JOIN entities c ON c.tenant_id = r.tenant_id AND c.id = r.from_entity
     JOIN entities p ON p.tenant_id = r.tenant_id AND p.id = r.to_entity
     WHERE r.tenant_id = $1 AND r.ended_at IS NULL
       AND r.rel_type IN ('MANAGES', 'OWNS', 'LIQUIDATES', 'REPRESENTS')
       AND c.entity_type = 'BUSINESS' AND p.archived_at IS NULL
       AND ($2::uuid IS NULL OR r.to_entity = $2::uuid)
     ORDER BY p.display_name NULLS LAST, c.display_name NULLS LAST`,
    [tx.tenantId, partyId ?? null],
  );
  return rows;
}

interface CompanyFacts {
  standing: CompanyStanding;
  statusText: string | null;
  kind: 'COMPANY' | 'ESTABLISHMENT' | null;
}

/** The facts that decide a company's standing, for many companies at once. */
async function standingsOf(
  tx: TenantTransaction,
  companyIds: readonly string[],
): Promise<Map<string, CompanyFacts>> {
  const result = new Map<string, CompanyFacts>();
  if (companyIds.length === 0) {
    return result;
  }
  const { rows } = await tx.query<{ entity_id: string; field_path: string; value: unknown }>(
    `SELECT entity_id, field_path, value FROM entity_profile
     WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])
       AND field_path IN ('cr.status', 'cr.status_code', 'cr.in_liquidation', 'cr.kind')`,
    [tx.tenantId, [...companyIds]],
  );
  const facts = new Map<string, Map<string, unknown>>();
  for (const row of rows) {
    const map = facts.get(row.entity_id) ?? new Map<string, unknown>();
    map.set(row.field_path, row.value);
    facts.set(row.entity_id, map);
  }
  for (const id of companyIds) {
    const map = facts.get(id);
    const code = map?.get('cr.status_code');
    const status = map?.get('cr.status');
    const kind = map?.get('cr.kind');
    result.set(id, {
      kind: kind === 'COMPANY' || kind === 'ESTABLISHMENT' ? kind : null,
      standing:
        map?.get('cr.in_liquidation') === true
          ? 'LIQUIDATION'
          : code === undefined
            ? 'UNKNOWN'
            : code === 1
              ? 'ACTIVE'
              : 'INACTIVE',
      statusText: typeof status === 'string' ? status : null,
    });
  }
  return result;
}

/** The identifiers of many entities at once, decrypted only to be shown. */
async function identifiersOf(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  entityIds: readonly string[],
): Promise<Map<string, { idType: string; display: string }[]>> {
  const result = new Map<string, { idType: string; display: string }[]>();
  if (entityIds.length === 0) {
    return result;
  }
  const { rows } = await tx.query<{
    entity_id: string;
    id_type: string;
    id_value_enc: Buffer;
    key_version: number;
  }>(
    `SELECT entity_id, id_type, id_value_enc, key_version FROM entity_identifiers
     WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])
       AND id_type IN ('NATIONAL_ID', 'IQAMA', 'PARTY_ID', 'CR', 'UNN')`,
    [tx.tenantId, [...entityIds]],
  );
  const encryptionKeys = new Map<number, Buffer>();
  for (const row of rows) {
    let key = encryptionKeys.get(row.key_version);
    if (key === undefined) {
      key = await keys.encryptionKey(tx.tenantId, row.key_version);
      encryptionKeys.set(row.key_version, key);
    }
    const list = result.get(row.entity_id) ?? [];
    list.push({
      idType: row.id_type,
      display: displayIdentifier(row.id_type, decryptIdentifier(key, row.id_value_enc)),
    });
    result.set(row.entity_id, list);
  }
  return result;
}

function identifierView(
  identifiers: readonly { idType: string; display: string }[],
  documentLabel: unknown,
): IdentifierView | null {
  const found = PARTY_ID_ORDER.map((idType) =>
    identifiers.find((identifier) => identifier.idType === idType),
  ).find((identifier) => identifier !== undefined);
  if (found === undefined) {
    return null;
  }
  return {
    idType: found.idType,
    labelAr:
      found.idType === 'PARTY_ID' && typeof documentLabel === 'string' && documentLabel !== ''
        ? documentLabel
        : (ID_SHORT_LABELS[found.idType] ?? found.idType),
    display: found.display,
  };
}

/**
 * Every related party of this subscriber, summarised once: who they are, the companies they
 * stand behind and in what role, how much of their authority is proven, and how many of those
 * companies are no longer in good standing.
 *
 * Read whole and filtered by the screen, as the customers are, until a measured list says
 * otherwise (rule 9).
 */
export async function summarizeParties(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  options: { limit?: number; partyId?: string } = {},
): Promise<RelatedPartySummary[]> {
  const relations = await partyRelations(tx, options.partyId);
  const parties = new Map<string, RelationRow[]>();
  for (const row of relations) {
    parties.set(row.party, [...(parties.get(row.party) ?? []), row]);
  }
  const partyIds = [...parties.keys()].slice(0, options.limit ?? 5_000);
  const companyIds = [...new Set(relations.map((row) => row.company))];

  const standings = await standingsOf(tx, companyIds);
  const identifiers = await identifiersOf(tx, keys, partyIds);

  const { rows: factRows } =
    partyIds.length === 0
      ? { rows: [] as { entity_id: string; field_path: string; value: unknown }[] }
      : await tx.query<{ entity_id: string; field_path: string; value: unknown }>(
          `SELECT entity_id, field_path, value FROM entity_profile
           WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])
             AND (field_path IN ('person.nationality', 'party.nationality', 'party.identity_type')
                  OR field_path LIKE 'manager.permissions.%')`,
          [tx.tenantId, partyIds],
        );
  const facts = new Map<string, Map<string, unknown>>();
  for (const row of factRows) {
    const map = facts.get(row.entity_id) ?? new Map<string, unknown>();
    map.set(row.field_path, row.value);
    facts.set(row.entity_id, map);
  }

  const { rows: customerRows } =
    partyIds.length === 0
      ? { rows: [] as { entity_id: string }[] }
      : await tx.query<{ entity_id: string }>(
          `SELECT DISTINCT entity_id FROM verification_runs
           WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])`,
          [tx.tenantId, partyIds],
        );
  const customers = new Set(customerRows.map((row) => row.entity_id));

  return partyIds.map((partyId): RelatedPartySummary => {
    const rows = parties.get(partyId) ?? [];
    const first = rows[0];
    const partyFacts = facts.get(partyId) ?? new Map<string, unknown>();
    const companies = new Map<string, PartyCompany>();
    for (const row of rows) {
      const role = ROLE_OF_RELATION[row.rel_type];
      if (role === undefined) {
        continue;
      }
      const standing = standings.get(row.company);
      const company = companies.get(row.company) ?? {
        entityId: row.company,
        name: row.company_name,
        entityType: 'BUSINESS',
        roles: [],
        standing: standing?.standing ?? 'UNKNOWN',
        statusText: standing?.statusText ?? null,
        kind: standing?.kind ?? null,
      };
      if (!company.roles.includes(role)) {
        company.roles.push(role);
      }
      companies.set(row.company, company);
    }
    const list = [...companies.values()];
    const count = (role: PartyRole): number =>
      list.filter((company) => company.roles.includes(role)).length;
    const identifier = identifierView(
      identifiers.get(partyId) ?? [],
      partyFacts.get('party.identity_type'),
    );
    const managed = list.filter((company) => company.roles.includes('MANAGER'));
    const checkable = identifier?.idType === 'NATIONAL_ID' || identifier?.idType === 'IQAMA';
    const nationality = partyFacts.get('person.nationality') ?? partyFacts.get('party.nationality');
    return {
      entityId: partyId,
      entityType: first?.party_type ?? 'PERSON',
      displayName: first?.party_name ?? null,
      identifier,
      nationality: typeof nationality === 'string' ? nationality : null,
      companies: list,
      roleCounts: {
        MANAGER: count('MANAGER'),
        PARTNER: count('PARTNER'),
        LIQUIDATOR: count('LIQUIDATOR'),
        GUARDIAN: count('GUARDIAN'),
      },
      authority: {
        verified: managed.filter((company) =>
          partyFacts.has(`manager.permissions.${company.entityId}`),
        ).length,
        checkable: checkable ? managed.length : 0,
      },
      isCustomer: customers.has(partyId),
      concerns: list.filter(
        (company) => company.standing === 'INACTIVE' || company.standing === 'LIQUIDATION',
      ).length,
      lastSeenAt: first?.last_seen_at ?? new Date(0),
    };
  });
}

/**
 * The parties a typed number belongs to: a national or residence ID, a registration or unified
 * number, or the number of another document. Found by keyed hash, the only way (rule 4).
 */
export async function findPartiesByIdentifier(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  typed: string,
): Promise<string[]> {
  const value = typed.replace(/[\s-]/g, '').toUpperCase();
  if (value.length < 4 || value.length > 30 || !/^[0-9A-Z]+$/.test(value)) {
    return [];
  }
  const types: IdentifierType[] = /^[0-9]{10}$/.test(value)
    ? ['NATIONAL_ID', 'IQAMA', 'CR', 'UNN', 'PARTY_ID']
    : ['PARTY_ID'];
  const found: string[] = [];
  for (const idType of types) {
    const entityId = await findEntityIdByIdentifier(tx, keys, idType, value);
    if (entityId !== null && !found.includes(entityId)) {
      found.push(entityId);
    }
  }
  return found;
}

/** One role somebody holds in one company, with everything the registry says of it. */
export interface PartyRoleView {
  company: PartyCompany;
  role: PartyRole;
  /** A manager's or a liquidator's positions. */
  positions: string[];
  /** What the registry calls them in this company: «سعودي», «مقيم», «فرد سعودي», «وقف». */
  typeText: string | null;
  licensed: boolean | null;
  permissions: Permission[] | null;
  permissionsCheckedAt: Date | null;
  /** A partner's roles: «مؤسس», «عضو». */
  partnerRoles: string[];
  shares: number | null;
  cashShares: number | null;
  inKindShares: number | null;
  profitPct: number | null;
  lossPct: number | null;
  licenseNumber: string | null;
  /** For a guardian, the minor partner they act for. */
  ward: string | null;
  isFather: boolean | null;
  observedAt: Date | null;
  /** Whether a manager's powers can be asked about: only with a national or residence ID. */
  checkable: boolean;
}

export interface PartyConcern {
  textAr: string;
  entities: LinkedEntity[];
}

export interface PartyRoles {
  roles: PartyRoleView[];
  companies: PartyCompany[];
  roleCounts: Readonly<Record<PartyRole, number>>;
  authority: { verified: number; checkable: number };
  /** What about their companies a reader should look at before relying on this person. */
  concerns: PartyConcern[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function permissionsOf(value: unknown): Permission[] | null {
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

/** The order roles are listed in within a company: authority first. */
const ROLE_ORDER: readonly PartyRole[] = ['MANAGER', 'PARTNER', 'LIQUIDATOR', 'GUARDIAN'];

/**
 * The roles somebody holds across this subscriber's companies, one line per company and role,
 * and what about those companies deserves a look.
 */
export async function getPartyRoles(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  entityId: string,
): Promise<PartyRoles> {
  const [summary] = await summarizeParties(tx, keys, { partyId: entityId });

  const { rows: factRows } = await tx.query<{
    field_path: string;
    value: unknown;
    observed_at: Date;
  }>(
    `SELECT field_path, value, observed_at FROM entity_profile
     WHERE tenant_id = $1 AND entity_id = $2`,
    [tx.tenantId, entityId],
  );
  const facts = new Map(
    factRows.map((row) => [row.field_path, { value: row.value, observedAt: row.observed_at }]),
  );
  const factOf = (path: string, company: string): unknown => facts.get(`${path}.${company}`)?.value;
  const observedOf = (paths: readonly string[], company: string): Date | null =>
    paths
      .map((path) => facts.get(`${path}.${company}`)?.observedAt)
      .filter((at): at is Date => at !== undefined)
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

  const companies = summary?.companies ?? [];
  const checkable =
    summary?.identifier?.idType === 'NATIONAL_ID' || summary?.identifier?.idType === 'IQAMA';
  const roles: PartyRoleView[] = [];
  for (const company of companies) {
    for (const role of ROLE_ORDER.filter((entry) => company.roles.includes(entry))) {
      const id = company.entityId;
      const permissions = facts.get(`manager.permissions.${id}`);
      const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
      roles.push({
        company,
        role,
        positions:
          role === 'MANAGER'
            ? strings(factOf('manager.positions', id))
            : role === 'LIQUIDATOR'
              ? strings(factOf('liquidator.positions', id))
              : [],
        typeText:
          role === 'MANAGER'
            ? text(factOf('manager.type', id))
            : role === 'PARTNER'
              ? text(factOf('partner.type', id))
              : role === 'LIQUIDATOR'
                ? text(factOf('liquidator.type', id))
                : null,
        licensed:
          role === 'MANAGER'
            ? ((factOf('manager.licensed', id) as boolean | undefined) ?? null)
            : null,
        permissions: role === 'MANAGER' && permissions ? permissionsOf(permissions.value) : null,
        permissionsCheckedAt: role === 'MANAGER' ? (permissions?.observedAt ?? null) : null,
        partnerRoles: role === 'PARTNER' ? strings(factOf('partner.roles', id)) : [],
        shares: role === 'PARTNER' ? numberOf(factOf('partner.shares', id)) : null,
        cashShares: role === 'PARTNER' ? numberOf(factOf('partner.cash_shares', id)) : null,
        inKindShares: role === 'PARTNER' ? numberOf(factOf('partner.in_kind_shares', id)) : null,
        profitPct: role === 'PARTNER' ? numberOf(factOf('partner.profit_pct', id)) : null,
        lossPct: role === 'PARTNER' ? numberOf(factOf('partner.loss_pct', id)) : null,
        licenseNumber: role === 'PARTNER' ? text(factOf('partner.license_number', id)) : null,
        ward: role === 'GUARDIAN' ? text(factOf('guardian.ward', id)) : null,
        isFather:
          role === 'GUARDIAN'
            ? ((factOf('guardian.is_father', id) as boolean | undefined) ?? null)
            : null,
        observedAt: observedOf(
          role === 'MANAGER'
            ? ['manager.permissions', 'manager.positions', 'manager.type']
            : role === 'PARTNER'
              ? ['partner.shares', 'partner.roles', 'partner.type']
              : role === 'LIQUIDATOR'
                ? ['liquidator.type', 'liquidator.positions']
                : ['guardian.ward'],
          id,
        ),
        checkable: role === 'MANAGER' && checkable,
      });
    }
  }

  const concerns: PartyConcern[] = [];
  const linked = (list: readonly PartyCompany[]): LinkedEntity[] =>
    list.map((company) => ({
      entityId: company.entityId,
      name: company.name,
      entityType: 'BUSINESS',
    }));
  const inLiquidation = companies.filter((company) => company.standing === 'LIQUIDATION');
  if (inLiquidation.length > 0) {
    concerns.push({
      textAr:
        inLiquidation.length === 1
          ? 'مرتبط بمنشأة تحت التصفية'
          : `مرتبط بـ${businesses(inLiquidation.length)} تحت التصفية`,
      entities: linked(inLiquidation),
    });
  }
  const inactive = companies.filter((company) => company.standing === 'INACTIVE');
  if (inactive.length > 0) {
    concerns.push({
      textAr:
        inactive.length === 1
          ? 'مرتبط بمنشأة سجلها غير فعّال'
          : `مرتبط بـ${businesses(inactive.length)} سجلاتها غير فعّالة`,
      entities: linked(inactive),
    });
  }
  const unproven = roles.filter(
    (role) => role.role === 'MANAGER' && role.checkable && role.permissions === null,
  );
  if (unproven.length > 0) {
    concerns.push({
      textAr: `صلاحياته في ${businesses(unproven.length)} لم يُتحقق منها`,
      entities: linked(unproven.map((role) => role.company)),
    });
  }

  return {
    roles,
    companies,
    roleCounts: summary?.roleCounts ?? { MANAGER: 0, PARTNER: 0, LIQUIDATOR: 0, GUARDIAN: 0 },
    authority: summary?.authority ?? { verified: 0, checkable: 0 },
    concerns,
  };
}

/** A verification of a company that recorded something about this party. */
export interface PartyMention {
  runId: string;
  reference: string | null;
  productCode: string;
  status: string;
  triggeredBy: string;
  at: Date;
  /** The company the verification was about. */
  company: LinkedEntity;
  fields: { fieldPath: string; value: unknown; kind: 'new' | 'confirmed' | 'changed' }[];
}

/**
 * The verifications that recorded something about somebody, newest first: the record of a
 * party's file. A person is never verified on their own, so their history is the history of
 * the companies that named them, each with what it wrote about them.
 */
export async function getPartyMentions(
  tx: TenantTransaction,
  entityId: string,
  limit = 25,
): Promise<PartyMention[]> {
  const { rows } = await tx.query<{
    run_id: string;
    reference: string | null;
    product_code: string;
    status: string;
    triggered_by: string;
    at: Date;
    company_id: string;
    company_name: string | null;
    company_type: string;
    field_path: string;
    value: unknown;
    previous_value: unknown;
    had_previous: boolean;
  }>(
    `WITH ordered AS (
       SELECT a.run_id, a.field_path, a.value,
              lag(a.value) OVER (PARTITION BY a.field_path ORDER BY a.observed_at, a.created_at)
                AS previous_value,
              lag(a.id) OVER (PARTITION BY a.field_path ORDER BY a.observed_at, a.created_at)
                IS NOT NULL AS had_previous
       FROM attestations a
       WHERE a.tenant_id = $1 AND a.entity_id = $2
     ),
     recent AS (
       SELECT run_id FROM attestations
       WHERE tenant_id = $1 AND entity_id = $2
       GROUP BY run_id
       ORDER BY max(observed_at) DESC
       LIMIT $3
     )
     SELECT o.run_id, r.reference, r.product_code, r.status, r.triggered_by, r.created_at AS at,
            c.id AS company_id, c.display_name AS company_name, c.entity_type AS company_type,
            o.field_path, o.value, o.previous_value, o.had_previous
     FROM ordered o
     JOIN recent ON recent.run_id = o.run_id
     JOIN verification_runs r ON r.tenant_id = $1 AND r.id = o.run_id
     JOIN entities c ON c.tenant_id = $1 AND c.id = r.entity_id
     ORDER BY r.created_at DESC, o.field_path`,
    [tx.tenantId, entityId, limit],
  );

  const byRun = new Map<string, PartyMention>();
  for (const row of rows) {
    let mention = byRun.get(row.run_id);
    if (mention === undefined) {
      mention = {
        runId: row.run_id,
        reference: row.reference,
        productCode: row.product_code,
        status: row.status,
        triggeredBy: row.triggered_by,
        at: row.at,
        company: { entityId: row.company_id, name: row.company_name, entityType: row.company_type },
        fields: [],
      };
      byRun.set(row.run_id, mention);
    }
    // One answer can name the same person twice, as a manager and as a partner, and write the
    // same fact for each: it is one line of what that verification recorded.
    if (mention.fields.some((field) => field.fieldPath === row.field_path)) {
      continue;
    }
    mention.fields.push({
      fieldPath: row.field_path,
      value: row.value,
      kind: !row.had_previous
        ? 'new'
        : JSON.stringify(row.value) === JSON.stringify(row.previous_value)
          ? 'confirmed'
          : 'changed',
    });
  }
  return [...byRun.values()];
}
