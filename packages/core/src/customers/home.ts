import type { TenantTransaction } from '@nx-verify/db';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import { getCommitment } from '../billing/entitlements.js';
import { listRecentRuns, type RunLogEntry } from '../verification/runs-log.js';
import { listChecks } from './checks.js';
import { summarizeCustomers } from './summaries.js';

/**
 * The subscriber's home screen (handoff screen 01).
 *
 * What a subscriber should know in three seconds: how many customers stand verified and how
 * many files still miss a section, how many facts do not hold, when the package ends, what
 * ran last, and what the month has consumed. The customer figures come from the same
 * summaries the customers list draws, so the home screen and the list never disagree.
 */

export interface HomeRun extends RunLogEntry {
  /**
   * What the customer's file says does not hold about this check, for the newest run of it
   * on the list: «تعارض في الاسم» after an IBAN check whose holder's name does not match.
   */
  conflictAr: string | null;
}

export interface HomeOverview {
  subscriberName: string | null;
  /** When the newest verification ran. */
  dataUpdatedAt: Date | null;
  customers: {
    all: number;
    /** Files whose every required section is verified. */
    verified: number;
    /** Of those, the ones first verified this month. */
    verifiedThisMonth: number;
    /** Files with a required section still missing. With the verified, every file. */
    incomplete: number;
    /** Sections whose verified facts do not hold, across every file. */
    conflicts: number;
  };
  commitment: { packageNameAr: string; termEnd: Date } | null;
  recent: HomeRun[];
  /** Operations charged this month, by product, most first. */
  consumption: { productCode: string; nameAr: string; count: number }[];
  performance: {
    runs: number;
    averageMs: number | null;
    /** Share of this month's calls that did not fail, 0 to 1. */
    completedShare: number | null;
  };
}

/** The first moment of this month in Riyadh, which keeps no daylight saving. */
export function riyadhMonthStart(now: Date): Date {
  const riyadh = new Date(now.getTime() + 3 * 3_600_000);
  return new Date(Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth(), 1) - 3 * 3_600_000);
}

export async function homeOverview(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  options: { now?: Date; recent?: number } = {},
): Promise<HomeOverview> {
  const now = options.now ?? new Date();
  const monthStart = riyadhMonthStart(now);

  const { rows: tenantRows } = await tx.query<{ legal_name: string }>(
    `SELECT legal_name FROM tenants WHERE id = $1`,
    [tx.tenantId],
  );

  // Every customer the list counts, not only its first page.
  const summaries = await summarizeCustomers(tx, keys, { limit: 5_000 }, { now });
  // Complete and incomplete split every file, so the home screen's two figures add up to the
  // customers list's count, as they do in the handoff (312 and 27 of 339).
  const complete = summaries.filter((summary) => summary.completeness === 100);

  const catalogue = await listChecks(tx);
  const sectionOf = new Map(catalogue.map((check) => [check.productCode, check.section]));
  const byEntity = new Map(summaries.map((summary) => [summary.entityId, summary]));
  const seen = new Set<string>();
  const recent: HomeRun[] = (await listRecentRuns(tx, { limit: options.recent ?? 6 })).map(
    (run) => {
      const key = `${run.entityId ?? ''}:${run.productCode}`;
      const newest = !seen.has(key);
      seen.add(key);
      const section = sectionOf.get(run.productCode);
      const issue =
        newest && run.entityId !== null && section !== undefined && run.status === 'OK'
          ? byEntity.get(run.entityId)?.conflictIssues.find((entry) => entry.section === section)
          : undefined;
      return { ...run, conflictAr: issue === undefined ? null : (issue.issueAr ?? 'تعارض') };
    },
  );

  const { rows: consumption } = await tx.query<{
    product_code: string;
    name_ar: string;
    count: string;
  }>(
    `SELECT r.product_code, p.name_ar, count(*)::text AS count
     FROM verification_runs r
     JOIN products p ON p.code = r.product_code
     WHERE r.tenant_id = $1 AND r.created_at >= $2
       AND r.status IN ('OK', 'PARTIAL', 'NOT_FOUND')
     GROUP BY r.product_code, p.name_ar, p.check_order
     ORDER BY count(*) DESC, p.check_order, r.product_code
     LIMIT 6`,
    [tx.tenantId, monthStart],
  );

  const { rows: performance } = await tx.query<{
    runs: string;
    average_ms: string | null;
    completed: string;
    newest: Date | null;
  }>(
    `SELECT count(*) FILTER (WHERE created_at >= $2 AND status <> 'PENDING')::text AS runs,
            avg(latency_ms) FILTER (WHERE created_at >= $2 AND status <> 'PENDING')::text AS average_ms,
            count(*) FILTER (WHERE created_at >= $2 AND status NOT IN ('PENDING', 'ERROR'))::text AS completed,
            max(created_at) AS newest
     FROM verification_runs
     WHERE tenant_id = $1`,
    [tx.tenantId, monthStart],
  );
  const runs = Number(performance[0]?.runs ?? 0);

  const commitment = await getCommitment(tx);

  return {
    subscriberName: tenantRows[0]?.legal_name ?? null,
    dataUpdatedAt: performance[0]?.newest ?? null,
    customers: {
      all: summaries.length,
      verified: complete.length,
      verifiedThisMonth: complete.filter(
        (summary) => summary.firstVerifiedAt !== null && summary.firstVerifiedAt >= monthStart,
      ).length,
      incomplete: summaries.filter((summary) => summary.completeness < 100).length,
      conflicts: summaries.reduce((sum, summary) => sum + summary.conflicts, 0),
    },
    commitment:
      commitment === null
        ? null
        : { packageNameAr: commitment.packageNameAr, termEnd: commitment.termEnd },
    recent,
    consumption: consumption.map((row) => ({
      productCode: row.product_code,
      nameAr: row.name_ar,
      count: Number(row.count),
    })),
    performance: {
      runs,
      averageMs:
        performance[0]?.average_ms === null || performance[0]?.average_ms === undefined
          ? null
          : Number(performance[0].average_ms),
      completedShare: runs === 0 ? null : Number(performance[0]?.completed ?? 0) / runs,
    },
  };
}
