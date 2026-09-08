import type { TenantTransaction } from '@nx-verify/db';
import { redactForLog } from '../logging/redact.js';

/**
 * The audit log.
 *
 * docs/01-blueprint.md section 10 requires that reads are logged too, credential reads
 * included, and that NX staff access appears here alongside customer access. An audit log
 * that only records writes answers the wrong question during an investigation.
 *
 * Metadata passes through the redaction layer on the way in, because an audit trail that
 * leaks identifiers is itself a finding.
 */

export type ActorType = 'USER' | 'API_KEY' | 'SYSTEM' | 'NX_STAFF';

export interface AuditEntry {
  actorType: ActorType;
  actorId: string;
  action: string;
  target?: string | null;
  ip?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function audit(tx: TenantTransaction, entry: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target, ip, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::inet, $7, $8::jsonb)`,
    [
      tx.tenantId,
      entry.actorType,
      entry.actorId,
      entry.action,
      entry.target ?? null,
      entry.ip ?? null,
      entry.requestId ?? null,
      entry.metadata ? JSON.stringify(redactForLog(entry.metadata)) : null,
    ],
  );
}

export interface AuditRecord extends AuditEntry {
  id: string;
  createdAt: Date;
}

export async function readAudit(
  tx: TenantTransaction,
  options: { limit?: number; action?: string } = {},
): Promise<AuditRecord[]> {
  const { rows } = await tx.query<{
    id: string;
    actor_type: ActorType;
    actor_id: string;
    action: string;
    target: string | null;
    ip: string | null;
    request_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: Date;
  }>(
    `SELECT id::text AS id, actor_type, actor_id, action, target, host(ip) AS ip,
            request_id, metadata, created_at
     FROM audit_log
     WHERE tenant_id = $1 AND ($2::text IS NULL OR action = $2)
     ORDER BY created_at DESC
     LIMIT $3`,
    [tx.tenantId, options.action ?? null, options.limit ?? 100],
  );

  return rows.map((row) => ({
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    target: row.target,
    ip: row.ip,
    requestId: row.request_id,
    ...(row.metadata ? { metadata: row.metadata } : {}),
    createdAt: row.created_at,
  }));
}
