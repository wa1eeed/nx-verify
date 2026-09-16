import type { TenantTransaction } from '@nx-verify/db';

/**
 * Noting that a customer's standing is out of date (ADR-140).
 *
 * Kept in its own module, free of the summary and the model, so the two paths that move a
 * customer can say so without pulling the scoring engine into a verification.
 *
 * What is written here is only what SQL can answer in two index lookups: what the registry
 * called them, and when they were last read. Those are the two columns the list navigates by,
 * so a customer verified a second ago is already in the right place and under the right
 * filter. Completeness and alerts are the model's answers and are left to the worker, which
 * is why the row is stamped stale rather than considered finished.
 *
 * The row is created if it is missing, because the first verification of somebody is the
 * moment they become a customer.
 */

/**
 * The kind and the newest observation, from the attestations themselves.
 *
 * `e` is the entity and `t` the tenant in the query this is spliced into. A kind the registry
 * never said, or said in words this platform does not know, is left null rather than written
 * and refused by the column's own check: a verification must not fail because a facet could
 * not be filled.
 */
const NAVIGATION_COLUMNS = `
  CASE
    WHEN e.entity_type = 'FREELANCER' THEN 'FREELANCER'
    ELSE (
      SELECT CASE WHEN a.value #>> '{}' IN ('COMPANY', 'ESTABLISHMENT')
                  THEN a.value #>> '{}' END
        FROM attestations a
       WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
         AND a.field_path = 'cr.kind' AND a.superseded_by IS NULL
       ORDER BY a.observed_at DESC
       LIMIT 1
    )
  END,
  (SELECT max(a.observed_at) FROM attestations a
    WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id AND a.superseded_by IS NULL)`;

const ON_CONFLICT = `
  ON CONFLICT (tenant_id, entity_id) DO UPDATE SET
    kind = EXCLUDED.kind,
    last_verified_at = EXCLUDED.last_verified_at,
    stale_at = now()`;

/** Every customer these ids name. Ids that are not customers are ignored, not refused. */
export async function markStandingStale(
  tx: TenantTransaction,
  entityIds: readonly string[],
): Promise<void> {
  if (entityIds.length === 0) {
    return;
  }
  await tx.query(
    `INSERT INTO customer_standing (tenant_id, entity_id, kind, last_verified_at, stale_at)
     SELECT e.tenant_id, e.id, ${NAVIGATION_COLUMNS}, now()
       FROM entities e
      WHERE e.tenant_id = $1 AND e.id = ANY($2::uuid[])
        AND e.entity_type IN ('BUSINESS', 'FREELANCER')
        AND e.archived_at IS NULL
        -- A company first met inside another company's answer is not a customer, however many
        -- facts it now has: somebody becomes one by being verified, not by being mentioned.
        AND EXISTS (SELECT 1 FROM verification_runs r
                     WHERE r.tenant_id = e.tenant_id AND r.entity_id = e.id)
     ${ON_CONFLICT}`,
    [tx.tenantId, entityIds],
  );
}

/**
 * The customer a run was about, read from the run itself.
 *
 * Taken from the row rather than passed in, so no caller of closeRun can forget it and no
 * signature has to carry an argument only this needs.
 */
export async function markStandingStaleFromRun(
  tx: TenantTransaction,
  runId: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO customer_standing (tenant_id, entity_id, kind, last_verified_at, stale_at)
     SELECT e.tenant_id, e.id, ${NAVIGATION_COLUMNS}, now()
       FROM verification_runs r
       JOIN entities e ON e.tenant_id = r.tenant_id AND e.id = r.entity_id
      WHERE r.tenant_id = $1 AND r.id = $2 AND r.entity_id IS NOT NULL
        AND e.entity_type IN ('BUSINESS', 'FREELANCER')
        AND e.archived_at IS NULL
     ${ON_CONFLICT}`,
    [tx.tenantId, runId],
  );
}
