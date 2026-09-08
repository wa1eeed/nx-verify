import type { TenantTransaction } from '@nx-verify/db';
import { riyalsToHalalas } from '../billing/money.js';

/**
 * The risk dashboard and the monthly report.
 *
 * Rule 2 shapes every query in this file. There is no cross tenant version of any of
 * these numbers, not even for our own internal reporting, and every one of them is
 * counted inside one tenant. A platform that quietly aggregates across customers to
 * produce a benchmark has broken the promise its isolation model is sold on.
 *
 * The counts come from grouped queries over the tenant's own rows rather than from a
 * shared counter, because a shared counter is exactly the kind of thing that starts
 * tenant scoped and stops being so during an optimisation.
 */

export interface FreshnessDistribution {
  fresh: number;
  expiring: number;
  expired: number;
  permanent: number;
}

export interface RiskDashboard {
  entities: number;
  /** Entities holding at least one expired field. */
  entitiesWithExpired: number;
  fieldFreshness: FreshnessDistribution;
  openChanges: { critical: number; warning: number; info: number };
  reviewQueue: { open: number; overdue: number; awaitingApproval: number };
  wallet: { balance: number; held: number; isLow: boolean };
  monitors: { active: number; budgetExhausted: number };
}

export async function riskDashboard(tx: TenantTransaction): Promise<RiskDashboard> {
  const { rows: freshness } = await tx.query<{ freshness: string; count: string }>(
    `SELECT freshness, count(*)::text AS count
     FROM entity_profile
     WHERE tenant_id = $1
     GROUP BY freshness`,
    [tx.tenantId],
  );

  const distribution: FreshnessDistribution = {
    fresh: 0,
    expiring: 0,
    expired: 0,
    permanent: 0,
  };
  for (const row of freshness) {
    if (row.freshness in distribution) {
      distribution[row.freshness as keyof FreshnessDistribution] = Number(row.count);
    }
  }

  const { rows: entityRows } = await tx.query<{ total: string; with_expired: string }>(
    `SELECT
       count(*)::text AS total,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM entity_profile p
         WHERE p.tenant_id = e.tenant_id AND p.entity_id = e.id AND p.freshness = 'expired'
       ))::text AS with_expired
     FROM entities e
     WHERE e.tenant_id = $1 AND e.archived_at IS NULL`,
    [tx.tenantId],
  );

  const { rows: changeRows } = await tx.query<{ severity: string; count: string }>(
    `SELECT severity, count(*)::text AS count
     FROM change_events
     WHERE tenant_id = $1 AND acknowledged_at IS NULL
     GROUP BY severity`,
    [tx.tenantId],
  );

  const changes = { critical: 0, warning: 0, info: 0 };
  for (const row of changeRows) {
    if (row.severity === 'CRITICAL') changes.critical = Number(row.count);
    if (row.severity === 'WARNING') changes.warning = Number(row.count);
    if (row.severity === 'INFO') changes.info = Number(row.count);
  }

  const { rows: queueRows } = await tx.query<{
    open: string;
    overdue: string;
    awaiting: string;
  }>(
    `SELECT
       count(*) FILTER (WHERE status IN ('OPEN', 'ASSIGNED'))::text AS open,
       count(*) FILTER (WHERE sla_due_at < now() AND closed_at IS NULL)::text AS overdue,
       count(*) FILTER (WHERE status = 'DECIDED')::text AS awaiting
     FROM review_cases
     WHERE tenant_id = $1`,
    [tx.tenantId],
  );

  const { rows: walletRows } = await tx.query<{
    balance: string;
    held: string;
    low_threshold: string;
  }>(`SELECT balance, held, low_threshold FROM wallets WHERE tenant_id = $1`, [tx.tenantId]);

  const { rows: monitorRows } = await tx.query<{ active: string; exhausted: string }>(
    `SELECT
       count(*) FILTER (WHERE status = 'active')::text AS active,
       count(*) FILTER (WHERE status = 'budget_exhausted')::text AS exhausted
     FROM monitors
     WHERE tenant_id = $1`,
    [tx.tenantId],
  );

  const balance = riyalsToHalalas(walletRows[0]?.balance ?? '0');
  const held = riyalsToHalalas(walletRows[0]?.held ?? '0');
  const threshold = Number(walletRows[0]?.low_threshold ?? 0.15);

  return {
    entities: Number(entityRows[0]?.total ?? 0),
    entitiesWithExpired: Number(entityRows[0]?.with_expired ?? 0),
    fieldFreshness: distribution,
    openChanges: changes,
    reviewQueue: {
      open: Number(queueRows[0]?.open ?? 0),
      overdue: Number(queueRows[0]?.overdue ?? 0),
      awaitingApproval: Number(queueRows[0]?.awaiting ?? 0),
    },
    wallet: {
      balance,
      held,
      isLow: balance > 0 && balance - held <= balance * threshold,
    },
    monitors: {
      active: Number(monitorRows[0]?.active ?? 0),
      budgetExhausted: Number(monitorRows[0]?.exhausted ?? 0),
    },
  };
}

export interface MonthlyReport {
  /** First day of the month covered, in ISO form. */
  month: string;
  verifications: { total: number; ok: number; partial: number; notFound: number; error: number };
  decisions: { pass: number; fail: number; review: number };
  changesDetected: { critical: number; warning: number; info: number };
  reviewCases: { opened: number; closed: number; medianHoursToClose: number | null };
  spend: { total: number; currency: string };
  /** How much of the balance the customer did not have to spend, thanks to freshness. */
  entitiesCoveredWithoutSpend: number;
}

/**
 * The report that goes to the customer's own risk committee, with our name on it.
 *
 * The last figure is deliberate: it counts entities that stayed current for the month
 * without a single paid re-verification. It is the number that makes the free freshness
 * layer visible, and it argues for the platform rather than for more spending.
 */
export async function buildMonthlyReport(
  tx: TenantTransaction,
  month: Date,
): Promise<MonthlyReport> {
  const start = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));

  const { rows: runRows } = await tx.query<{
    status: string;
    decision: string | null;
    count: string;
    spend: string;
  }>(
    `SELECT status, decision, count(*)::text AS count,
            COALESCE(sum(billed_amount), 0)::text AS spend
     FROM verification_runs
     WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
     GROUP BY status, decision`,
    [tx.tenantId, start, end],
  );

  const verifications = { total: 0, ok: 0, partial: 0, notFound: 0, error: 0 };
  const decisions = { pass: 0, fail: 0, review: 0 };
  let spend = 0;

  for (const row of runRows) {
    const count = Number(row.count);
    verifications.total += count;
    spend += riyalsToHalalas(row.spend);

    if (row.status === 'OK') verifications.ok += count;
    if (row.status === 'PARTIAL') verifications.partial += count;
    if (row.status === 'NOT_FOUND') verifications.notFound += count;
    if (row.status === 'ERROR') verifications.error += count;

    if (row.decision === 'PASS') decisions.pass += count;
    if (row.decision === 'FAIL') decisions.fail += count;
    if (row.decision === 'REVIEW') decisions.review += count;
  }

  const { rows: changeRows } = await tx.query<{ severity: string; count: string }>(
    `SELECT severity, count(*)::text AS count
     FROM change_events
     WHERE tenant_id = $1 AND detected_at >= $2 AND detected_at < $3
     GROUP BY severity`,
    [tx.tenantId, start, end],
  );

  const changesDetected = { critical: 0, warning: 0, info: 0 };
  for (const row of changeRows) {
    if (row.severity === 'CRITICAL') changesDetected.critical = Number(row.count);
    if (row.severity === 'WARNING') changesDetected.warning = Number(row.count);
    if (row.severity === 'INFO') changesDetected.info = Number(row.count);
  }

  const { rows: caseRows } = await tx.query<{
    opened: string;
    closed: string;
    median_hours: string | null;
  }>(
    `SELECT
       count(*) FILTER (WHERE opened_at >= $2 AND opened_at < $3)::text AS opened,
       count(*) FILTER (WHERE closed_at >= $2 AND closed_at < $3)::text AS closed,
       percentile_cont(0.5) WITHIN GROUP (
         ORDER BY extract(epoch FROM (closed_at - opened_at)) / 3600
       ) FILTER (WHERE closed_at >= $2 AND closed_at < $3)::text AS median_hours
     FROM review_cases
     WHERE tenant_id = $1`,
    [tx.tenantId, start, end],
  );

  const { rows: coveredRows } = await tx.query<{ covered: string }>(
    `SELECT count(DISTINCT p.entity_id)::text AS covered
     FROM entity_profile p
     WHERE p.tenant_id = $1
       AND p.freshness IN ('fresh', 'permanent')
       AND NOT EXISTS (
         SELECT 1 FROM verification_runs r
         WHERE r.tenant_id = p.tenant_id AND r.entity_id = p.entity_id
           AND r.created_at >= $2 AND r.created_at < $3
           AND r.billed_amount > 0
       )`,
    [tx.tenantId, start, end],
  );

  return {
    month: start.toISOString().slice(0, 10),
    verifications,
    decisions,
    changesDetected,
    reviewCases: {
      opened: Number(caseRows[0]?.opened ?? 0),
      closed: Number(caseRows[0]?.closed ?? 0),
      medianHoursToClose:
        caseRows[0]?.median_hours == null ? null : Number(caseRows[0].median_hours),
    },
    spend: { total: spend, currency: 'SAR' },
    entitiesCoveredWithoutSpend: Number(coveredRows[0]?.covered ?? 0),
  };
}

export interface PortfolioHealth {
  portfolioId: string;
  code: string;
  nameAr: string;
  entities: number;
  withExpired: number;
  openCases: number;
}

export async function portfolioHealth(tx: TenantTransaction): Promise<PortfolioHealth[]> {
  const { rows } = await tx.query<{
    id: string;
    code: string;
    name_ar: string;
    entities: string;
    with_expired: string;
    open_cases: string;
  }>(
    `SELECT p.id, p.code, p.name_ar,
            count(DISTINCT m.entity_id)::text AS entities,
            count(DISTINCT m.entity_id) FILTER (WHERE EXISTS (
              SELECT 1 FROM entity_profile ep
              WHERE ep.tenant_id = m.tenant_id AND ep.entity_id = m.entity_id
                AND ep.freshness = 'expired'
            ))::text AS with_expired,
            count(DISTINCT c.id) FILTER (WHERE c.closed_at IS NULL)::text AS open_cases
     FROM portfolios p
     LEFT JOIN portfolio_members m ON m.tenant_id = p.tenant_id AND m.portfolio_id = p.id
     LEFT JOIN review_cases c ON c.tenant_id = m.tenant_id AND c.entity_id = m.entity_id
     WHERE p.tenant_id = $1
     GROUP BY p.id
     ORDER BY p.code`,
    [tx.tenantId],
  );

  return rows.map((row) => ({
    portfolioId: row.id,
    code: row.code,
    nameAr: row.name_ar,
    entities: Number(row.entities),
    withExpired: Number(row.with_expired),
    openCases: Number(row.open_cases),
  }));
}
