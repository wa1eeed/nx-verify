import type { Queryable, TenantTransaction } from '@nx-verify/db';

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

export async function recordMargin(
  tx: TenantTransaction,
  input: RecordMarginInput,
): Promise<void> {
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
    period_start: Date;
    runs: number;
    package_runs: number;
    billed_halalas: string;
    provider_cost_halalas: string;
  }>(
    `SELECT m.tenant_id, t.legal_name, m.product_code, m.period_start, m.runs,
            m.package_runs, m.billed_halalas::text, m.provider_cost_halalas::text
     FROM margin_counters m
     JOIN tenants t ON t.id = m.tenant_id
     WHERE ($1::date IS NULL OR m.period_start >= $1)
       AND ($2::date IS NULL OR m.period_start <= $2)
       AND ($3::uuid IS NULL OR m.tenant_id = $3)
       AND ($4::text IS NULL OR m.product_code = $4)
     ORDER BY m.period_start DESC, t.legal_name, m.product_code`,
    [
      query.from ?? null,
      query.to ?? null,
      query.tenantId ?? null,
      query.productCode ?? null,
    ],
  );

  return rows.map((row) => {
    const billed = Number(row.billed_halalas);
    const cost = Number(row.provider_cost_halalas);
    return {
      tenantId: row.tenant_id,
      tenantName: row.legal_name,
      productCode: row.product_code,
      periodStart: row.period_start,
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
