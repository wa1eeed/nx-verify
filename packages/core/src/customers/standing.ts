import type { TenantTransaction } from '@nx-verify/db';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import { summarizeCustomers, type CustomerSummary } from './summaries.js';
import { riskModelVersion } from './risk-policy.js';
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
 *
 * Instead the row records which risk model computed it, and that is compared when the row is
 * read (ADR-175, migration 0067): a row whose recorded model is not the one in force now was
 * computed under a superseded one, and it says so the instant the model moves rather than when
 * a sweep happens past it. Nothing is written to say a model changed, so nothing crosses the
 * boundary. The value is `app.risk_model_version()`, read on the subscriber's own connection,
 * so their own overrides are in it and nobody else's are.
 *
 * The age sweep stays beside it, because the facts under a row age for their own reasons and a
 * model that has not moved says nothing about a customer who has.
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
 *
 * `modelVersion` is the risk model these summaries were computed under, read before they were
 * computed (ADR-175). A caller that does not pass it has the model read here instead, which is
 * right only when nothing could have moved in between: a model edited while a page was being
 * summarised would then be recorded as the one that made it, and the row would read as current
 * while being one edit behind.
 */
export async function writeStanding(
  tx: TenantTransaction,
  summaries: readonly StandingSummary[],
  asked: readonly string[] = summaries.map((summary) => summary.entityId),
  modelVersion: string | null = null,
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
    // The model the caller gave, and otherwise read here in a subquery rather than called per
    // row, so it is one InitPlan for the statement and not one aggregate per customer written.
    `INSERT INTO customer_standing
       (tenant_id, entity_id, kind, last_verified_at, completeness, open_alerts, risk_score,
        risk_model_version, stale_at, computed_at)
     SELECT $1, row.entity_id, row.kind, row.last_verified_at, row.completeness, row.open_alerts,
            row.risk_score, COALESCE($3::text, (SELECT app.risk_model_version())), NULL, now()
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
       risk_model_version = EXCLUDED.risk_model_version,
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
      modelVersion,
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
  // Read before the summary, not after it: a model edited while these were being computed is
  // then recorded as the older one, and the row reads as old until it is computed again.
  const modelVersion = await riskModelVersion(tx);
  const summaries = await summarizeCustomers(
    tx,
    keys,
    { entityIds },
    options.now === undefined ? {} : { now: options.now },
  );
  return writeStanding(tx, summaries, entityIds, modelVersion);
}

export interface SweepOptions {
  /** How many customers one sweep recomputes. Small, because it runs often. */
  batch?: number;
  /**
   * A row untouched for longer than this is swept even without being stamped. It is about the
   * facts under the row rather than the model over it: a customer's answers age whether or not
   * anybody edited a weight, and nothing stamps a row for simply having got old.
   */
  maxAgeMinutes?: number;
  now?: Date;
}

/**
 * One sweep: the customers stamped as moved, the ones computed under a model that has since
 * changed, and then the ones nobody has looked at in a while.
 *
 * The middle group is claimed the moment the model moves rather than when the row ages past
 * `maxAgeMinutes`, because the row says which model made it (ADR-175) and the comparison is
 * one value read on this subscriber's own connection.
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
    // The model is read once for the statement, as an uncorrelated subquery, not per row.
    `SELECT entity_id FROM customer_standing
      WHERE tenant_id = $1
        AND (stale_at IS NOT NULL
             OR risk_model_version IS DISTINCT FROM (SELECT app.risk_model_version())
             OR computed_at < now() - make_interval(mins => $2))
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
