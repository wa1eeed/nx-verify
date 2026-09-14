import type { TenantTransaction } from '@nx-verify/db';
import { riyalsToHalalas } from '../billing/money.js';

/**
 * Every verification a subscriber ran, newest first.
 *
 * The customer file answers "what do we know about this company". This answers the other
 * question a compliance team is asked: "what did we check, when, for whom, and what did it
 * cost". Both read the same rows, inside the subscriber's own scope, and neither names the
 * provider that carried the call (rule 5): the column is never selected.
 */

export interface RunLogEntry {
  runId: string;
  reference: string | null;
  productCode: string;
  productNameAr: string;
  entityId: string | null;
  entityName: string | null;
  entityType: string | null;
  status: string;
  decision: string | null;
  triggeredBy: string;
  billedHalalas: number | null;
  chargeSource: string;
  createdAt: Date;
}

export interface RunLogFilter {
  productCode?: string | null;
  status?: string | null;
  decision?: string | null;
  triggeredBy?: string | null;
  /** Only runs from this moment on: a month's report. */
  since?: Date | null;
  limit?: number;
}

export async function listRecentRuns(
  tx: TenantTransaction,
  filter: RunLogFilter = {},
): Promise<RunLogEntry[]> {
  const { rows } = await tx.query<{
    id: string;
    reference: string | null;
    product_code: string;
    name_ar: string | null;
    entity_id: string | null;
    display_name: string | null;
    entity_type: string | null;
    status: string;
    decision: string | null;
    triggered_by: string;
    billed_amount: string | null;
    charge_source: string;
    created_at: Date;
  }>(
    `SELECT r.id, r.reference, r.product_code, p.name_ar, r.entity_id, e.display_name,
            e.entity_type, r.status, r.decision, r.triggered_by, r.billed_amount::text AS billed_amount,
            r.charge_source, r.created_at
     FROM verification_runs r
     LEFT JOIN products p ON p.code = r.product_code
     LEFT JOIN entities e ON e.tenant_id = r.tenant_id AND e.id = r.entity_id
     WHERE r.tenant_id = $1
       AND ($2::text IS NULL OR r.product_code = $2)
       AND ($3::text IS NULL OR r.status = $3)
       AND ($4::text IS NULL OR r.decision = $4)
       AND ($5::text IS NULL OR r.triggered_by = $5)
       AND ($7::timestamptz IS NULL OR r.created_at >= $7)
     ORDER BY r.created_at DESC
     LIMIT $6`,
    [
      tx.tenantId,
      filter.productCode ?? null,
      filter.status ?? null,
      filter.decision ?? null,
      filter.triggeredBy ?? null,
      Math.min(Math.max(filter.limit ?? 100, 1), 5_000),
      filter.since ?? null,
    ],
  );

  return rows.map((row) => ({
    runId: row.id,
    reference: row.reference,
    productCode: row.product_code,
    productNameAr: row.name_ar ?? row.product_code,
    entityId: row.entity_id,
    entityName: row.display_name,
    entityType: row.entity_type,
    status: row.status,
    decision: row.decision,
    triggeredBy: row.triggered_by,
    // The column is riyals, the screen reads halalas: converted here, once.
    billedHalalas: row.billed_amount === null ? null : riyalsToHalalas(row.billed_amount),
    chargeSource: row.charge_source,
    createdAt: row.created_at,
  }));
}

export interface RunCounts {
  thisMonth: number;
  needsDecision: number;
  failed: number;
}

export async function countRuns(tx: TenantTransaction, now: Date = new Date()): Promise<RunCounts> {
  const { rows } = await tx.query<{ this_month: string; needs_decision: string; failed: string }>(
    `SELECT count(*) FILTER (WHERE created_at >= date_trunc('month', $2::timestamptz))::text AS this_month,
            count(*) FILTER (WHERE decision = 'REVIEW')::text AS needs_decision,
            count(*) FILTER (WHERE status = 'ERROR')::text AS failed
     FROM verification_runs
     WHERE tenant_id = $1`,
    [tx.tenantId, now],
  );
  const row = rows[0];
  return {
    thisMonth: Number(row?.this_month ?? 0),
    needsDecision: Number(row?.needs_decision ?? 0),
    failed: Number(row?.failed ?? 0),
  };
}

export interface EntityRun {
  runId: string;
  reference: string | null;
  productCode: string;
  status: string;
  /** What started it: a call, a person, a monitor sweep, a batch (ADR-106). */
  triggeredBy: string;
  at: Date;
}

/**
 * One customer's verifications, newest first, whatever they ended in.
 *
 * The file's timeline reads this rather than the attestations, because a verification that
 * failed wrote nothing and still belongs on the record of what was tried.
 */
export async function listEntityRuns(
  tx: TenantTransaction,
  entityId: string,
  limit = 30,
): Promise<EntityRun[]> {
  const { rows } = await tx.query<{
    id: string;
    reference: string | null;
    product_code: string;
    status: string;
    triggered_by: string;
    created_at: Date;
  }>(
    `SELECT id, reference, product_code, status, triggered_by, created_at
     FROM verification_runs
     WHERE tenant_id = $1 AND entity_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [tx.tenantId, entityId, limit],
  );
  return rows.map((row) => ({
    runId: row.id,
    reference: row.reference,
    productCode: row.product_code,
    status: row.status,
    triggeredBy: row.triggered_by,
    at: row.created_at,
  }));
}
