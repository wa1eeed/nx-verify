import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { readPage, type Page, type PageRequest } from '../pagination.js';
import { riyalsToHalalas } from './money.js';

/**
 * What we earn, aggregated to the only shape an internal role may read.
 *
 * The numbers come from runs, and runs are subscriber data that the operator connection
 * must never reach. So each run adds to a counter of one subscriber, one month, one
 * product: a count and two sums. That row answers "what did we earn on this service for
 * this customer" and cannot answer anything about whom they verified, which is what makes
 * it safe to read across subscribers and useless for anything else.
 *
 * What the counter does not answer is «كم أدخلنا هذا الشهر». `billed_halalas` is what a wallet
 * was charged, and it is zero for every run a plan, a bundle or the free window paid for, while
 * the provider cost of that same run is counted in full. Three of the four ways this platform
 * takes money are therefore invisible to it. `platformRevenue` and `platformMonth` at the foot
 * of this file read the other two mechanisms beside it, so that a screen asking for revenue
 * gets revenue rather than one quarter of it.
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
  /** Runs a plan or a bundle had already paid for. They earn nothing in this month. */
  packageRuns: number;
  /** Charged to the wallet. Zero for a plan, a bundle or a free re check (verify.ts). */
  billedHalalas: number;
  /** Every run's provider cost, including the runs that were not billed. */
  providerCostHalalas: number;
  grossHalalas: number;
  /**
   * The realised margin on wallet charged runs, and nothing else.
   *
   * It leaves out the plan fee and the bundle sale that bought the covered runs, and it counts
   * the cost of those runs, so a row with `packageRuns` in it is lower than the business. Null
   * when nothing was billed: a margin on zero revenue is not zero, it is undefined.
   */
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
  /** Wallet charged runs only. Not the platform's revenue: see `platformRevenue`. */
  billedHalalas: number;
  /** Every run's provider cost, the covered ones included. */
  providerCostHalalas: number;
  packageRuns: number;
  /**
   * Every run the filters leave, so a screen can say what share of the work earned nothing
   * here. Without it `packageRuns` is a number with nothing to be a share of.
   */
  runs: number;
}

/** The figures above the report, over every row the filters leave rather than the page on screen. */
export async function marginTotals(
  operator: Queryable,
  query: MarginQuery = {},
): Promise<MarginTotals> {
  const { rows } = await operator.query<{
    billed: string;
    cost: string;
    package_runs: string;
    runs: string;
  }>(
    `SELECT coalesce(sum(m.billed_halalas), 0)::text AS billed,
            coalesce(sum(m.provider_cost_halalas), 0)::text AS cost,
            coalesce(sum(m.package_runs), 0)::text AS package_runs,
            coalesce(sum(m.runs), 0)::text AS runs
     FROM margin_counters m WHERE ${MARGIN_FILTER}`,
    marginFilterValues(query),
  );
  return {
    billedHalalas: Number(rows[0]?.billed ?? 0),
    providerCostHalalas: Number(rows[0]?.cost ?? 0),
    packageRuns: Number(rows[0]?.package_runs ?? 0),
    runs: Number(rows[0]?.runs ?? 0),
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

// ── what «الإيراد» is, when it is not one quarter of itself ───────────────────────────────

/**
 * A month's revenue, by the mechanism that produced it.
 *
 * A subscriber pays in four ways and only one of them moves `billed_halalas`: the wallet. A
 * plan is paid as a monthly fee, a bundle is paid when it is bought, and a free re check is
 * paid by nobody. A screen that prints the counter's sum as «الإيراد» therefore reads a plan
 * heavy subscriber as earning nothing while their provider cost is counted against them in
 * full, which is the opposite of what is true.
 *
 * Read on the operator connection and crossing subscribers by design, like everything else in
 * this file: three sums and no row that says whom anything was about. Sandbox workspaces are
 * left out of all three, because a sandbox pays nothing and is not a customer.
 */
export interface RevenueBreakdown {
  /** Runs the wallet was charged for. The only part the counters know about. */
  walletHalalas: number;
  /** Bundles whose transfer was confirmed inside the period. */
  bundleHalalas: number;
  /** The period's share of every plan fee in force, an annual fee divided by twelve. */
  planFeeHalalas: number;
  /** The three together, before VAT. What an owner means by «الإيراد». */
  totalHalalas: number;
}

export async function platformRevenue(
  operator: Queryable,
  from: Date,
  to: Date,
): Promise<RevenueBreakdown> {
  const day = from.toISOString().slice(0, 10);
  const { rows: runs } = await operator.query<{ billed: string }>(
    `SELECT coalesce(sum(m.billed_halalas), 0)::text AS billed
     FROM margin_counters m
     JOIN tenants t ON t.id = m.tenant_id AND t.sandbox_of IS NULL
     WHERE m.period_start = $1::date`,
    [day],
  );
  const { rows: bundles } = await operator.query<{ amount: string }>(
    `SELECT coalesce(sum(r.amount), 0)::text AS amount
     FROM topup_requests r
     JOIN tenants t ON t.id = r.tenant_id AND t.sandbox_of IS NULL
     WHERE r.status = 'CONFIRMED' AND r.bundle_code IS NOT NULL
       AND r.settled_at >= $1 AND r.settled_at < $2`,
    [from, to],
  );
  const { rows: fees } = await operator.query<{ fees: string }>(
    `SELECT coalesce(round(sum(
              CASE WHEN p.billing_model = 'ANNUAL' THEN c.platform_fee_halalas / 12.0
                   ELSE c.platform_fee_halalas END)), 0)::text AS fees
     FROM tenant_commitments c
     JOIN packages p ON p.code = c.package_code
     JOIN tenants t ON t.id = c.tenant_id AND t.sandbox_of IS NULL AND t.status = 'active'
     WHERE c.status IN ('active', 'trial')
       AND coalesce(c.term_start, c.started_at) < $2 AND c.term_end > $1`,
    [from, to],
  );

  const wallet = Number(runs[0]?.billed ?? 0);
  // The amount column is riyals, not halalas, and reading it as halalas understates a bundle
  // sale by a factor of a hundred.
  const bundle = riyalsToHalalas(bundles[0]?.amount ?? '0');
  const planFee = Number(fees[0]?.fees ?? 0);
  return {
    walletHalalas: wallet,
    bundleHalalas: bundle,
    planFeeHalalas: planFee,
    totalHalalas: wallet + bundle + planFee,
  };
}

/**
 * One month as a platform owner means it: every riyal in, against every riyal of provider cost.
 *
 * The margin here is not the margin of the report above. That one is realised on wallet charged
 * runs, and it is the right figure for a single subscriber on a single service. This one is the
 * platform's: it puts the plan fee and the bundle sale that bought the covered work on the same
 * side of the division as the cost of doing it. A screen must say which of the two it is
 * showing, because after the platform registers for VAT they will not even share a cost basis.
 *
 * Sandbox runs are excluded on both sides, so the cost of a subscriber testing does not appear
 * as a month that lost money.
 */
export interface PlatformMonth {
  monthStart: Date;
  revenue: RevenueBreakdown;
  /** Every run this month, sandbox workspaces excluded. */
  runs: number;
  /** Of those, the ones a plan or a bundle had already paid for. */
  coveredRuns: number;
  providerCostHalalas: number;
  /** Over the whole revenue, not over the wallet alone. Null when nothing came in. */
  marginPct: number | null;
}

export async function platformMonth(
  operator: Queryable,
  options: { now?: Date } = {},
): Promise<PlatformMonth> {
  const now = options.now ?? new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const { rows } = await operator.query<{ runs: string; covered: string; cost: string }>(
    // The sandbox join is the point of this query rather than an ornament: without it a
    // subscriber's test traffic adds runs and provider cost to a month that never earned a
    // riyal from it, and drags the margin down.
    `SELECT coalesce(sum(m.runs), 0)::text AS runs,
            coalesce(sum(m.package_runs), 0)::text AS covered,
            coalesce(sum(m.provider_cost_halalas), 0)::text AS cost
     FROM margin_counters m
     JOIN tenants t ON t.id = m.tenant_id AND t.sandbox_of IS NULL
     WHERE m.period_start = $1::date`,
    [from.toISOString().slice(0, 10)],
  );
  const revenue = await platformRevenue(operator, from, to);
  const cost = Number(rows[0]?.cost ?? 0);

  return {
    monthStart: from,
    revenue,
    runs: Number(rows[0]?.runs ?? 0),
    coveredRuns: Number(rows[0]?.covered ?? 0),
    providerCostHalalas: cost,
    marginPct:
      revenue.totalHalalas === 0
        ? null
        : Math.round(((revenue.totalHalalas - cost) / revenue.totalHalalas) * 100),
  };
}
