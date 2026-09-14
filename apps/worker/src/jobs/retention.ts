import { audit, pruneApiRequests } from '@nx-verify/core';
import type { TenantTransaction } from '@nx-verify/db';

/**
 * The daily retention job.
 *
 * docs/01-blueprint.md calls retention a selling point rather than a burden, and it is:
 * "your data is destroyed automatically after the agreed period" is a sentence a
 * compliance officer likes hearing. It only works if it actually runs.
 *
 * ADR-028: the schema document describes tombstoning an attestation that is still the
 * live value for its field. That cannot be done by editing the row, because rule 1
 * forbids updating an attestation and guard 01 enforces it. So destruction is applied
 * where the personal data actually is: the identifiers. The attestation values stay,
 * because they carry no raw identifier, and the entity is archived. The record of what
 * was verified survives; the ability to tie it to a person does not.
 *
 * Deletion runs as nx_retention, the only role in the system that holds DELETE on
 * attestations.
 */

export interface RetentionSummary {
  attestationsDestroyed: number;
  identifiersDestroyed: number;
  entitiesArchived: number;
  /** Waits the provider already answered, or that we gave up on. */
  waitsPruned: number;
  /** Links that have expired or been withdrawn. */
  sharesPruned: number;
  /** Verification requests long finished, and drafts nobody came back to. */
  requestsPruned: number;
}

export interface RetentionOptions {
  actorId?: string;
  now?: Date;
  limit?: number;
}

export async function enforceRetention(
  tx: TenantTransaction,
  options: RetentionOptions = {},
): Promise<RetentionSummary> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 5_000;

  const { rows: policy } = await tx.query<{ retention_days: number }>(
    `SELECT retention_days FROM tenants WHERE id = $1`,
    [tx.tenantId],
  );
  const retentionDays = policy[0]?.retention_days ?? 1825;

  // Superseded rows past the retention window are destroyed outright. They are history
  // nobody is contractually owed any more.
  const { rowCount: attestationsDestroyed } = await tx.query(
    `DELETE FROM attestations
     WHERE tenant_id = $1
       AND superseded_by IS NOT NULL
       AND observed_at < $2::timestamptz - make_interval(days => $3)
       AND id IN (
         SELECT id FROM attestations
         WHERE tenant_id = $1 AND superseded_by IS NOT NULL
           AND observed_at < $2::timestamptz - make_interval(days => $3)
         LIMIT $4
       )`,
    [tx.tenantId, now, retentionDays, limit],
  );

  // Entities whose most recent knowledge is older than the window lose the part that
  // identifies a person, and are archived. What was verified stays; who it was does not.
  const { rows: stale } = await tx.query<{ id: string }>(
    `SELECT e.id
     FROM entities e
     WHERE e.tenant_id = $1
       AND e.archived_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM attestations a
         WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
           AND a.observed_at >= $2::timestamptz - make_interval(days => $3)
       )
       AND EXISTS (SELECT 1 FROM attestations a WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id)
     LIMIT $4`,
    [tx.tenantId, now, retentionDays, limit],
  );

  let identifiersDestroyed = 0;
  for (const entity of stale) {
    const { rowCount } = await tx.query(
      `DELETE FROM entity_identifiers WHERE tenant_id = $1 AND entity_id = $2`,
      [tx.tenantId, entity.id],
    );
    identifiersDestroyed += rowCount ?? 0;

    await tx.query(`UPDATE entities SET archived_at = now() WHERE tenant_id = $1 AND id = $2`, [
      tx.tenantId,
      entity.id,
    ]);
  }

  const summary: RetentionSummary = {
    attestationsDestroyed: attestationsDestroyed ?? 0,
    identifiersDestroyed,
    entitiesArchived: stale.length,
    waitsPruned: 0,
    sharesPruned: 0,
    requestsPruned: 0,
  };

  /**
   * Operational rows, on their own clock.
   *
   * Kept apart from the retention window above, which answers a legal question about how
   * long a customer's knowledge is held. These answer an operational one about tables
   * that grow with traffic and are worth nothing once they have done their job.
   *
   * A wait that is still WAITING is never touched: the provider may still answer it, and
   * deleting it would leave a run that can never be resumed and never closed.
   *
   * A share row is deleted only once it has expired or been withdrawn, and the record of
   * the disclosure survives it: the audit log carries profile.shared with the share id,
   * which is what anybody asking months later actually needs.
   *
   * topup_requests is not here. It is a financial record with a tax invoice on it, and
   * money does not age out of relevance on an operations schedule. The role that runs
   * this holds SELECT on that table and nothing more.
   */
  const { rowCount: waitsPruned } = await tx.query(
    `DELETE FROM run_waits
     WHERE tenant_id = $1 AND status <> 'WAITING'
       AND resolved_at < $2::timestamptz - make_interval(days => 30)`,
    [tx.tenantId, now],
  );

  const { rowCount: sharesPruned } = await tx.query(
    `DELETE FROM profile_shares
     WHERE tenant_id = $1
       AND (revoked_at IS NOT NULL OR expires_at < now())
       AND greatest(coalesce(revoked_at, expires_at), expires_at)
           < $2::timestamptz - make_interval(days => 180)`,
    [tx.tenantId, now],
  );

  /**
   * A verification request is the working copy of a click: once its checks ran, the runs
   * and the file are the record, and the request is only the screen's memory of it. A draft
   * holds a sealed number somebody typed and never used, and ninety days is long enough to
   * come back to it.
   */
  const { rowCount: requestsPruned } = await tx.query(
    `DELETE FROM verification_requests
     WHERE tenant_id = $1
       AND ((status IN ('DONE', 'CANCELLED')
             AND coalesce(completed_at, created_at) < $2::timestamptz - make_interval(days => 30))
         OR (status = 'DRAFT' AND created_at < $2::timestamptz - make_interval(days => 90)))`,
    [tx.tenantId, now],
  );

  summary.waitsPruned = waitsPruned ?? 0;
  summary.sharesPruned = sharesPruned ?? 0;
  summary.requestsPruned = requestsPruned ?? 0;

  // The destruction is itself auditable, which is the half of the promise that makes it
  // worth anything to a regulator.
  await audit(tx, {
    actorType: 'SYSTEM',
    actorId: options.actorId ?? 'retention-job',
    action: 'retention.enforced',
    metadata: { ...summary, retentionDays },
  });

  return summary;
}

/**
 * Clears provider callbacks that have done their job.
 *
 * Global rather than per subscriber, because a delivery lands before anyone knows whose
 * it is and the table carries no tenant at all. Age alone is the rule: a wait expires
 * within a day, so a delivery still unmatched after three months will never be matched,
 * and keeping it teaches nobody anything a support ticket has not already answered.
 */
export async function pruneInboundEvents(
  db: { query: TenantTransaction['query'] },
  olderThanDays = 90,
): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM inbound_events
     WHERE received_at < now() - make_interval(days => $1)`,
    [olderThanDays],
  );
  return rowCount ?? 0;
}

/** Keeps the audit log partitioned ahead of time. */
/**
 * Clears old request logs.
 *
 * Separate from the retention policy for attestations, and deliberately so: that one
 * answers a legal question about how long a customer's knowledge is kept, and this one
 * answers an operational question about a table that grows faster than any other and is
 * worth little after a month.
 */
export async function pruneRequestLogs(tx: TenantTransaction, olderThanDays = 30): Promise<number> {
  return pruneApiRequests(tx, olderThanDays);
}

export async function ensureAuditPartitions(
  tx: TenantTransaction,
  monthsAhead = 2,
  now = new Date(),
): Promise<string[]> {
  const created: string[] = [];

  for (let offset = 0; offset <= monthsAhead; offset += 1) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const { rows } = await tx.query<{ create_audit_partition: string }>(
      `SELECT app.create_audit_partition($1::date)`,
      [month.toISOString().slice(0, 10)],
    );
    const name = rows[0]?.create_audit_partition;
    if (name) {
      created.push(name);
    }
  }

  return created;
}
