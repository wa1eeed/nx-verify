import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { readPage, type Page, type PageRequest } from '../pagination.js';

/**
 * What we earn, aggregated to the only shape an internal role may read.
 *
 * The numbers come from runs, and runs are subscriber data that the operator connection
 * must never reach. So each run adds to a counter of one subscriber, one month, one
 * product: a count and two sums. That row answers "what did we earn on this service for
 * this customer" and cannot answer anything about whom they verified, which is what makes
 * it safe to read across subscribers and useless for anything else.
 *
 * See ADR-080.
 */

export interface RecordMarginInput {
  productCode: string;
  /** What the subscriber was charged, in halalas. Zero when a package covered it. */
  billedHalalas: number;
  /** What the providers charged us, when they say. */
  providerCostHalalas?: number;
  /** True when the package paid, so the report can show work that earns nothing today. */
  coveredByPackage?: boolean;
}

export async function recordMargin(tx: TenantTransaction, input: RecordMarginInput): Promise<void> {
  await tx.query(
    `INSERT INTO margin_counters (tenant_id, period_start, product_code, runs,
                                  billed_halalas, provider_cost_halalas, package_runs)
     VALUES ($1, date_trunc('month', now())::date, $2, 1, $3, $4, $5)
     ON CONFLICT (tenant_id, period_start, product_code) DO UPDATE SET
       runs = margin_counters.runs + 1,
       billed_halalas = margin_counters.billed_halalas + EXCLUDED.billed_halalas,
       provider_cost_halalas =
         margin_counters.provider_cost_halalas + EXCLUDED.provider_cost_halalas,
       package_runs = margin_counters.package_runs + EXCLUDED.package_runs,
       updated_at = now()`,
    [
      tx.tenantId,
      input.productCode,
      Math.max(0, Math.round(input.billedHalalas)),
      Math.max(0, Math.round(input.providerCostHalalas ?? 0)),
      input.coveredByPackage ? 1 : 0,
    ],
  );
}

export interface MarginRow {
  tenantId: string;
  tenantName: string;
  productCode: string;
  periodStart: Date;
  runs: number;
  packageRuns: number;
  billedHalalas: number;
  providerCostHalalas: number;
  grossHalalas: number;
  /** Null when nothing was billed: a margin on zero revenue is not zero, it is undefined. */
  marginPct: number | null;
}

export interface MarginQuery {
  from?: Date;
  to?: Date;
  tenantId?: string;
  productCode?: string;
  limit?: number;
  offset?: number;
}

const MARGIN_FILTER = `($1::date IS NULL OR m.period_start >= $1)
       AND ($2::date IS NULL OR m.period_start <= $2)
       AND ($3::uuid IS NULL OR m.tenant_id = $3)
       AND ($4::text IS NULL OR m.product_code = $4)`;

function marginFilterValues(query: MarginQuery): unknown[] {
  return [query.from ?? null, query.to ?? null, query.tenantId ?? null, query.productCode ?? null];
}

/** How many rows of the report the filters leave, for its pages. */
export async function countMarginRows(
  operator: Queryable,
  query: MarginQuery = {},
): Promise<number> {
  const { rows } = await operator.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM margin_counters m WHERE ${MARGIN_FILTER}`,
    marginFilterValues(query),
  );
  return Number(rows[0]?.count ?? 0);
}

export interface MarginTotals {
  billedHalalas: number;
  providerCostHalalas: number;
  packageRuns: number;
}

/** The figures above the report, over every row the filters leave rather than the page on screen. */
export async function marginTotals(
  operator: Queryable,
  query: MarginQuery = {},
): Promise<MarginTotals> {
  const { rows } = await operator.query<{ billed: string; cost: string; package_runs: string }>(
    `SELECT coalesce(sum(m.billed_halalas), 0)::text AS billed,
            coalesce(sum(m.provider_cost_halalas), 0)::text AS cost,
            coalesce(sum(m.package_runs), 0)::text AS package_runs
     FROM margin_counters m WHERE ${MARGIN_FILTER}`,
    marginFilterValues(query),
  );
  return {
    billedHalalas: Number(rows[0]?.billed ?? 0),
    providerCostHalalas: Number(rows[0]?.cost ?? 0),
    packageRuns: Number(rows[0]?.package_runs ?? 0),
  };
}

/** One page of the report, newest month first. */
export async function pageMarginReport(
  operator: Queryable,
  query: Omit<MarginQuery, 'limit' | 'offset'>,
  request: PageRequest,
): Promise<Page<MarginRow>> {
  return readPage(
    request,
    () => countMarginRows(operator, query),
    (window) => marginReport(operator, { ...query, ...window }),
  );
}

/**
 * The margin report, read on the operator connection.
 *
 * Crossing subscribers is the whole point here and is why the source is a counter rather
 * than the runs: an operator screen that can total revenue must not be one query away
 * from reading a decision about a named company.
 */
export async function marginReport(
  operator: Queryable,
  query: MarginQuery = {},
): Promise<MarginRow[]> {
  const { rows } = await operator.query<{
    tenant_id: string;
    legal_name: string;
    product_code: string;
    period_start: string;
    runs: number;
    package_runs: number;
    billed_halalas: string;
    provider_cost_halalas: string;
  }>(
    // The month as text, read back as its first day in UTC: a date column read into a
    // JavaScript Date lands on local midnight, which east of Greenwich is the month before.
    `SELECT m.tenant_id, t.legal_name, m.product_code, m.period_start::text AS period_start, m.runs,
            m.package_runs, m.billed_halalas::text, m.provider_cost_halalas::text
     FROM margin_counters m
     JOIN tenants t ON t.id = m.tenant_id
     WHERE ${MARGIN_FILTER}
     ORDER BY m.period_start DESC, t.legal_name, m.product_code, m.tenant_id
     LIMIT $5 OFFSET $6`,
    [...marginFilterValues(query), query.limit ?? null, Math.max(query.offset ?? 0, 0)],
  );

  return rows.map((row) => {
    const billed = Number(row.billed_halalas);
    const cost = Number(row.provider_cost_halalas);
    return {
      tenantId: row.tenant_id,
      tenantName: row.legal_name,
      productCode: row.product_code,
      periodStart: new Date(`${row.period_start}T00:00:00Z`),
      runs: row.runs,
      packageRuns: row.package_runs,
      billedHalalas: billed,
      providerCostHalalas: cost,
      grossHalalas: billed - cost,
      // A margin on no revenue is undefined rather than zero, and a report that prints
      // zero there invites somebody to average it.
      marginPct: billed === 0 ? null : Math.round(((billed - cost) / billed) * 100),
    };
  });
}
