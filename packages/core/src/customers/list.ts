import type { TenantTransaction } from '@nx-verify/db';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import { findEntityIdByIdentifier } from '../repositories/identifiers.js';
import type { CustomerKind } from './checks.js';

/**
 * The customers list.
 *
 * Customers are the companies, establishments and freelancers a subscriber verified. The
 * people and accounts found inside those verifications are not customers: they appear in
 * the files they belong to, and a person who manages three customers is shown there, not
 * as a fourth row here.
 *
 * **Narrow first, then read** (ADR-140). The page of customers is chosen from
 * `customer_standing`, which is one indexed row each, and only then are the facts fetched for
 * those twenty five. The order used to be an aggregate over every attestation of the
 * workspace, which meant a million rows were built to return a hundred and the LIMIT decided
 * nothing; at fifty thousand customers that screen did not answer inside ten minutes
 * (docs/explanation/measurements.md).
 *
 * Searching accepts a name or a number: a number is looked up by its keyed hash, the only way
 * it can be found (rule 4).
 */

export interface CustomerRow {
  entityId: string;
  displayName: string | null;
  kind: CustomerKind | null;
  entityType: string;
  /** The registry status for a business, the certificate status for a freelancer. */
  statusText: string | null;
  statusTone: 'fresh' | 'critical' | 'neutral';
  lastVerifiedAt: Date | null;
  expiredFacts: number;
  /** Detected changes not yet acknowledged, and answers that deserve a look. */
  attention: number;
}

export interface CustomerFilter {
  kind?: CustomerKind | null;
  search?: string | null;
  /** Only customers with something open: a conflict, or a change nobody has read. */
  alertsOnly?: boolean;
  /**
   * Exactly these customers, in the order given. Skips the index and every filter: it is how
   * a page already chosen is read, and how one customer is refreshed.
   */
  entityIds?: readonly string[] | undefined;
  limit?: number;
  offset?: number;
}

const CERTIFICATE_WORDS: Readonly<Record<string, string>> = {
  ACTIVE: 'سارية',
  EXPIRED: 'منتهية',
  CANCELED: 'ملغاة',
  REVOKED: 'مسحوبة',
};

/** The five field paths a row draws. Asked for by name so the profile returns five rows, not twenty. */
const ROW_FIELDS = [
  'cr.kind',
  'cr.status',
  'cr.status_code',
  'freelance.certificate_status',
  'bank.iban_ownership',
] as const;

const MAX_PAGE = 5_000;

/**
 * The profile of several customers, asked for one customer at a time.
 *
 * Awkward on purpose, and the three shapes were measured against the same data rather than
 * argued about (docs/explanation/measurements.md):
 *
 *   entity_id = $2, one customer          2 ms
 *   entity_id = ANY(array of 25)        495 ms
 *   a LATERAL over the same 25       20,000 ms
 *
 * `entity_profile` is a DISTINCT ON whose keys include `entity_id`, so a **constant** on that
 * column is pushed into it and the time to live is resolved for twenty facts. An array is one
 * qual over the whole view and a lateral is a parameterised one, and neither is pushed: the
 * planner builds far more of the workspace's profile than was asked for, twenty five times over
 * in the lateral's case.
 *
 * So the loop is the fast path, not a fallback. Twenty five round trips on one connection cost
 * less than one query that cannot be narrowed.
 */
export async function profileOfEach<T extends Record<string, unknown>>(
  tx: TenantTransaction,
  ids: readonly string[],
  select: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (const id of ids) {
    const result = await tx.query<T>(select, [tx.tenantId, id]);
    rows.push(...result.rows);
  }
  return rows;
}

/** How many rows the caller asked for, held to something a screen can draw. */
function windowOf(filter: CustomerFilter): { limit: number; offset: number } {
  return {
    limit: Math.min(Math.max(filter.limit ?? 100, 1), MAX_PAGE),
    offset: Math.max(filter.offset ?? 0, 0),
  };
}

/**
 * The entity a typed number belongs to, or null when it belongs to none.
 *
 * Returns undefined when nothing was typed, which is a different answer from «nothing
 * matched»: one means every customer, the other means none.
 */
async function searchedEntity(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  search: string,
): Promise<string | null | undefined> {
  if (!/^[0-9]{10}$/.test(search)) {
    return undefined;
  }
  for (const idType of ['UNN', 'CR', 'NATIONAL_ID', 'IQAMA'] as const) {
    const found = await findEntityIdByIdentifier(tx, keys, idType, search);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/** The filter, as the four parameters every query over the standing table takes. */
function standingParams(
  tx: TenantTransaction,
  filter: CustomerFilter,
  byIdentifier: string | null,
  search: string,
): [string, string | null, string | null, string | null, boolean, string[] | null] {
  return [
    tx.tenantId,
    byIdentifier,
    byIdentifier === null && search !== '' ? search : null,
    filter.kind ?? null,
    filter.alertsOnly === true,
    filter.entityIds === undefined ? null : [...filter.entityIds].slice(0, MAX_PAGE),
  ];
}

/**
 * The shared WHERE of the list: one workspace, not archived, and whatever was filtered.
 *
 * Written once because the page and its count must agree exactly. A count that answers a
 * different question from the rows below it is worse than no count.
 */
const STANDING_WHERE = `
  s.tenant_id = $1
  AND e.archived_at IS NULL
  AND ($2::uuid IS NULL OR s.entity_id = $2)
  AND ($3::text IS NULL OR e.display_name ILIKE '%' || $3 || '%')
  AND ($4::text IS NULL OR s.kind = $4)
  AND ($5 IS NOT TRUE OR s.open_alerts > 0)
  AND ($6::uuid[] IS NULL OR s.entity_id = ANY($6::uuid[]))`;

/** Which customers this page is, and how many there are in all under the same filter. */
export async function pickCustomers(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  filter: CustomerFilter = {},
): Promise<{ entityIds: string[]; total: number }> {
  const search = filter.search?.trim() ?? '';
  const byIdentifier = (await searchedEntity(tx, keys, search)) ?? null;
  if (byIdentifier === null && /^[0-9]{10}$/.test(search)) {
    return { entityIds: [], total: 0 };
  }
  const params = standingParams(tx, filter, byIdentifier, search);
  const { limit, offset } = windowOf(filter);

  const [{ rows: picked }, { rows: counted }] = [
    await tx.query<{ entity_id: string }>(
      `SELECT s.entity_id
         FROM customer_standing s
         JOIN entities e ON e.tenant_id = s.tenant_id AND e.id = s.entity_id
        WHERE ${STANDING_WHERE}
        ORDER BY s.last_verified_at DESC NULLS LAST, s.entity_id DESC
        LIMIT $7 OFFSET $8`,
      [...params, limit, offset],
    ),
    await tx.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM customer_standing s
         JOIN entities e ON e.tenant_id = s.tenant_id AND e.id = s.entity_id
        WHERE ${STANDING_WHERE}`,
      params,
    ),
  ];

  return {
    entityIds: picked.map((row) => row.entity_id),
    total: Number(counted[0]?.total ?? 0),
  };
}

interface EntityRow {
  id: string;
  display_name: string | null;
  entity_type: string;
}

/**
 * The rows for a set of customers already chosen.
 *
 * Three queries, each keyed on those ids. The profile one is the whole reason this screen
 * works now: `entity_id` is one of the view's own distinct keys, so the qual is pushed into
 * it and the time to live is resolved for a hundred facts rather than a million.
 */
async function rowsFor(tx: TenantTransaction, ids: readonly string[]): Promise<CustomerRow[]> {
  if (ids.length === 0) {
    return [];
  }
  const entities = await tx.query<EntityRow>(
    // Archived on purpose: somebody taken off the list is not a customer, however they were
    // asked for. A page already excluded them; a refresh of one by id must too.
    `SELECT id, display_name, entity_type FROM entities
      WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL`,
    [tx.tenantId, ids],
  );
  const facts = {
    rows: await profileOfEach<{
      entity_id: string;
      field_path: string;
      value: unknown;
      observed_at: Date;
      freshness: string;
    }>(
      tx,
      ids,
      `SELECT entity_id, field_path, value, observed_at, freshness FROM entity_profile
        WHERE tenant_id = $1 AND entity_id = $2`,
    ),
  };
  const changes = await tx.query<{ entity_id: string; open: string }>(
    `SELECT entity_id, count(*)::text AS open FROM change_events
      WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[]) AND acknowledged_at IS NULL
      GROUP BY entity_id`,
    [tx.tenantId, ids],
  );

  const named = new Map(entities.rows.map((row) => [row.id, row]));
  const openChanges = new Map(changes.rows.map((row) => [row.entity_id, Number(row.open)]));
  const wanted = new Set<string>(ROW_FIELDS);
  const byEntity = new Map<
    string,
    { values: Map<string, unknown>; newest: Date | null; expired: number }
  >();
  for (const fact of facts.rows) {
    const entry = byEntity.get(fact.entity_id) ?? {
      values: new Map<string, unknown>(),
      newest: null,
      expired: 0,
    };
    if (wanted.has(fact.field_path)) {
      entry.values.set(fact.field_path, fact.value);
    }
    // Every fact counts towards «آخر تحقق» and towards what has aged out, not only the five
    // a row draws: the column says when this customer was last read, not when its name was.
    if (entry.newest === null || fact.observed_at > entry.newest) {
      entry.newest = fact.observed_at;
    }
    if (fact.freshness === 'expired') {
      entry.expired += 1;
    }
    byEntity.set(fact.entity_id, entry);
  }

  return ids.flatMap((id) => {
    const entity = named.get(id);
    if (entity === undefined) {
      return [];
    }
    const entry = byEntity.get(id);
    const value = (path: string): unknown => entry?.values.get(path) ?? null;
    const freelancer = entity.entity_type === 'FREELANCER';
    const declared = value('cr.kind');
    const certificate = value('freelance.certificate_status');
    const statusCode = value('cr.status_code');
    const kind: CustomerKind | null = freelancer
      ? 'FREELANCER'
      : declared === 'COMPANY' || declared === 'ESTABLISHMENT'
        ? declared
        : null;
    const statusText = freelancer
      ? typeof certificate === 'string'
        ? (CERTIFICATE_WORDS[certificate] ?? certificate)
        : null
      : typeof value('cr.status') === 'string'
        ? (value('cr.status') as string)
        : null;
    const healthy = freelancer ? certificate === 'ACTIVE' : statusCode === 1;
    const known = freelancer ? certificate !== null : statusCode !== null;
    const iban = value('bank.iban_ownership');
    const mismatched = iban === 'NO_MATCH' || iban === 'PARTIAL' ? 1 : 0;
    return [
      {
        entityId: id,
        displayName: entity.display_name,
        kind,
        entityType: entity.entity_type,
        statusText,
        statusTone: (!known
          ? 'neutral'
          : healthy
            ? 'fresh'
            : 'critical') as CustomerRow['statusTone'],
        lastVerifiedAt: entry?.newest ?? null,
        expiredFacts: entry?.expired ?? 0,
        attention: (openChanges.get(id) ?? 0) + mismatched + (known && !healthy ? 1 : 0),
      },
    ];
  });
}

export async function listCustomers(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  filter: CustomerFilter = {},
): Promise<CustomerRow[]> {
  if (filter.entityIds !== undefined) {
    return rowsFor(tx, filter.entityIds.slice(0, MAX_PAGE));
  }
  const { entityIds } = await pickCustomers(tx, keys, filter);
  return rowsFor(tx, entityIds);
}

/**
 * The customers a typed number belongs to: a unified or registration number, a national or
 * residence ID, or an IBAN, which finds every customer holding that account.
 *
 * Found by keyed hash, the only way a number can be found (rule 4), and only among this
 * subscriber's own records (rule 2). Nothing typed is kept.
 */
export async function findCustomersByIdentifier(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  typed: string,
): Promise<string[]> {
  const value = typed.replace(/[\s-]/g, '').toUpperCase();
  if (/^SA[0-9]{22}$/.test(value)) {
    const account = await findEntityIdByIdentifier(tx, keys, 'IBAN', value);
    if (account === null) {
      return [];
    }
    const { rows } = await tx.query<{ holder: string }>(
      // `ended_at IS NULL` is the index's own predicate as well as the question: an account
      // somebody used to hold is not an account they hold.
      `SELECT DISTINCT from_entity AS holder FROM entity_relations
       WHERE tenant_id = $1 AND to_entity = $2 AND rel_type = 'HOLDS_ACCOUNT'
         AND ended_at IS NULL`,
      [tx.tenantId, account],
    );
    return rows.map((row) => row.holder);
  }
  if (!/^[0-9]{10}$/.test(value)) {
    return [];
  }
  const found: string[] = [];
  for (const idType of ['UNN', 'CR', 'NATIONAL_ID', 'IQAMA'] as const) {
    const entityId = await findEntityIdByIdentifier(tx, keys, idType, value);
    if (entityId !== null && !found.includes(entityId)) {
      found.push(entityId);
    }
  }
  return found;
}

/** Whether what was typed into a search is a number to look up rather than a name. */
export function looksLikeIdentifier(typed: string): boolean {
  const value = typed.replace(/[\s-]/g, '').toUpperCase();
  return /^[0-9]{10}$/.test(value) || /^SA[0-9]{22}$/.test(value);
}

export interface CustomerCounts {
  all: number;
  companies: number;
  establishments: number;
  freelancers: number;
  complete: number;
  incomplete: number;
  alerts: number;
}

/**
 * The number beside each filter, from one scan of one row per customer.
 *
 * Three of these used to be counted by summarising every customer in the workspace and
 * counting the results in JavaScript, which is why the screen asked for five thousand
 * summaries to draw twenty five rows. Completeness and alerts are the model's answers, so
 * they are read from the standing row the worker keeps rather than recomputed here: a facet
 * that lags a minute is useful, and one that waits for a million rows is not.
 */
export async function countCustomers(tx: TenantTransaction): Promise<CustomerCounts> {
  const { rows } = await tx.query<{
    all: string;
    companies: string;
    establishments: string;
    freelancers: string;
    complete: string;
    alerts: string;
  }>(
    `SELECT count(*)::text AS all,
            count(*) FILTER (WHERE s.kind = 'COMPANY')::text AS companies,
            count(*) FILTER (WHERE s.kind = 'ESTABLISHMENT')::text AS establishments,
            count(*) FILTER (WHERE s.kind = 'FREELANCER')::text AS freelancers,
            count(*) FILTER (WHERE s.completeness = 100)::text AS complete,
            count(*) FILTER (WHERE s.open_alerts > 0)::text AS alerts
       FROM customer_standing s
       JOIN entities e ON e.tenant_id = s.tenant_id AND e.id = s.entity_id
      WHERE s.tenant_id = $1 AND e.archived_at IS NULL`,
    [tx.tenantId],
  );
  const row = rows[0];
  const all = Number(row?.all ?? 0);
  const complete = Number(row?.complete ?? 0);
  return {
    all,
    companies: Number(row?.companies ?? 0),
    establishments: Number(row?.establishments ?? 0),
    freelancers: Number(row?.freelancers ?? 0),
    complete,
    incomplete: all - complete,
    alerts: Number(row?.alerts ?? 0),
  };
}
