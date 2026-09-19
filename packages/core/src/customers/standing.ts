import type { TenantTransaction } from '@nx-verify/db';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import { summarizeCustomers, type CustomerSummary } from './summaries.js';
export { markStandingStale, markStandingStaleFromRun } from './standing-stale.js';

/**
 * Keeping `customer_standing` true (ADR-140).
 *
 * The table exists so the list can filter, order and count without summarising everybody. It
 * is a projection, which means the only interesting question is when it lies and what is done
 * about it.
 *
 * Three things make a row wrong. The customer was verified again, so their facts moved; a
 * change on them was read, so their alerts moved; or the model itself moved, because staff
 * edited a risk weight (ADR-138) or switched a module (ADR-137) and every score in the
 * workspace changed with it.
 *
 * The first two stamp the row as they happen, from the path that caused them. The third is
 * not stamped at all, deliberately: the model is edited on a staff connection, and a staff
 * connection has no business writing a table keyed on a subscriber's customers (guard 02).
 * Instead the worker sweeps the oldest rows continuously, so a model change reaches every
 * facet within a sweep without anybody reaching across the boundary to make it happen.
 *
 * What is never stale is what a reader sees. The rows a screen draws are summarised live from
 * the model, and this table decides only which rows and in what order. A facet that lags a
 * minute is useful; a facet that waits for a million rows is not.
 *
 * `risk_score` is here for the same reason the other two are: it is what «مخاطر عالية» filters
 * and counts by, held against the bands the subscriber set rather than against a number stored
 * beside it, so moving a band moves the facet at once and moves each row's score on the next
 * sweep. A customer nobody has swept yet has no score and falls in no band, so the facet
 * under-reports rather than inventing a band for somebody nobody has rated.
 */

export interface StandingRefresh {
  refreshed: number;
}

/**
 * Writes down summaries somebody has already computed.
 *
 * Separate from computing them, because the customers screen summarises its own page live and
 * would otherwise throw the answer away. Writing it back means the list heals whatever anybody
 * actually looks at, and the worker is left with the rest.
 *
 * `asked` is every customer the caller set out to read: any of them missing from the summaries
 * is archived or no longer a customer, and its row goes rather than lingering as a count of
 * somebody who is not there.
 */
export async function writeStanding(
  tx: TenantTransaction,
  summaries: readonly StandingSummary[],
  asked: readonly string[] = summaries.map((summary) => summary.entityId),
): Promise<StandingRefresh> {
  const answered = new Set(summaries.map((summary) => summary.entityId));
  const gone = asked.filter((id) => !answered.has(id));
  if (gone.length > 0) {
    await tx.query(
      `DELETE FROM customer_standing WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])`,
      [tx.tenantId, gone],
    );
  }
  if (summaries.length === 0) {
    return { refreshed: 0 };
  }
  await tx.query(
    `INSERT INTO customer_standing
       (tenant_id, entity_id, kind, last_verified_at, completeness, open_alerts, risk_score,
        stale_at, computed_at)
     SELECT $1, row.entity_id, row.kind, row.last_verified_at, row.completeness, row.open_alerts,
            row.risk_score, NULL, now()
       FROM jsonb_to_recordset($2::jsonb) AS row (
         entity_id uuid, kind text, last_verified_at timestamptz,
         completeness int, open_alerts int, risk_score int
       )
     ON CONFLICT (tenant_id, entity_id) DO UPDATE SET
       kind = EXCLUDED.kind,
       last_verified_at = EXCLUDED.last_verified_at,
       completeness = EXCLUDED.completeness,
       open_alerts = EXCLUDED.open_alerts,
       risk_score = EXCLUDED.risk_score,
       stale_at = NULL,
       computed_at = now()`,
    [
      tx.tenantId,
      JSON.stringify(
        summaries.map((summary) => ({
          entity_id: summary.entityId,
          kind: summary.kind,
          last_verified_at: summary.lastVerifiedAt,
          completeness: summary.completeness,
          open_alerts: summary.openAlerts,
          risk_score: summary.riskScore,
        })),
      ),
    ],
  );
  return { refreshed: summaries.length };
}

/** The part of a summary this table keeps. */
export type StandingSummary = Pick<
  CustomerSummary,
  'entityId' | 'kind' | 'lastVerifiedAt' | 'completeness' | 'openAlerts' | 'riskScore'
>;

/**
 * Computes where these customers stand and writes it down.
 *
 * The numbers come from the same summary the screen draws, so the table can never hold a
 * standing the file would disagree with; it can only hold one from a minute ago.
 */
export async function refreshStanding(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  entityIds: readonly string[],
  options: { now?: Date } = {},
): Promise<StandingRefresh> {
  if (entityIds.length === 0) {
    return { refreshed: 0 };
  }
  const summaries = await summarizeCustomers(
    tx,
    keys,
    { entityIds },
    options.now === undefined ? {} : { now: options.now },
  );
  return writeStanding(tx, summaries, entityIds);
}

export interface SweepOptions {
  /** How many customers one sweep recomputes. Small, because it runs often. */
  batch?: number;
  /**
   * A row untouched for longer than this is swept even without being stamped, which is how a
   * change to the model reaches every facet without staff writing to a subscriber's table.
   */
  maxAgeMinutes?: number;
  now?: Date;
}

/**
 * One sweep: the customers stamped as moved, then the ones nobody has looked at in a while.
 *
 * Bounded by design. A workspace of fifty thousand is swept over hours rather than in one
 * transaction that holds a connection for minutes, because the point of the table is that no
 * single request ever waits for every customer.
 */
export async function sweepStanding(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  options: SweepOptions = {},
): Promise<StandingRefresh> {
  const batch = Math.min(Math.max(options.batch ?? 200, 1), 2_000);
  const maxAge = Math.max(options.maxAgeMinutes ?? 60, 1);
  const { rows } = await tx.query<{ entity_id: string }>(
    `SELECT entity_id FROM customer_standing
      WHERE tenant_id = $1
        AND (stale_at IS NOT NULL OR computed_at < now() - make_interval(mins => $2))
      ORDER BY stale_at IS NULL, computed_at
      LIMIT $3`,
    [tx.tenantId, maxAge, batch],
  );
  if (rows.length === 0) {
    return { refreshed: 0 };
  }
  return refreshStanding(
    tx,
    keys,
    rows.map((row) => row.entity_id),
    options.now === undefined ? {} : { now: options.now },
  );
}
