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
  };

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

/** Keeps the audit log partitioned ahead of time. */
/**
 * Clears old request logs.
 *
 * Separate from the retention policy for attestations, and deliberately so: that one
 * answers a legal question about how long a customer's knowledge is kept, and this one
 * answers an operational question about a table that grows faster than any other and is
 * worth little after a month.
 */
export async function pruneRequestLogs(
  tx: TenantTransaction,
  olderThanDays = 30,
): Promise<number> {
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
