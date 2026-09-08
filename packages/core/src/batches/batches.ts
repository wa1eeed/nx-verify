import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { audit } from '../auth/audit.js';
import { resolvePrice } from '../billing/price-book.js';
import { getWallet } from '../billing/wallet.js';
import { halalasToDecimalString, riyalsToHalalas } from '../billing/money.js';

/**
 * Smart batches.
 *
 * The rule that shapes this file: nothing runs until someone has been shown the cost and
 * agreed to it, and what runs is what they agreed to. A batch confirmed against four
 * hundred riyals must not quietly execute at nine hundred because more entities became
 * eligible between the preview and the click.
 *
 * That is why the confirmation carries the figure. A preview that the system does not
 * hold itself to is decoration.
 */

export type BatchStatus = 'DRAFT' | 'CONFIRMED' | 'RUNNING' | 'DONE' | 'CANCELLED';

/**
 * Selection criteria, a closed set for the same reason decision conditions are: a query
 * stored in a column is a query nobody reviews.
 */
export interface BatchCriteria {
  entityType?: string;
  portfolioId?: string | null;
  /** Entities whose knowledge of this field is older than this many days. */
  fieldPath?: string;
  olderThanDays?: number;
  /** Entities with no attestation for this field at all. */
  missingField?: string;
  limit?: number;
}

export interface BatchPreview {
  entities: number;
  /** In halalas. */
  estimatedCost: number;
  unitPrice: number;
  /** True when the balance cannot cover the estimate. */
  exceedsBalance: boolean;
  availableBalance: number;
}

/**
 * Counts and prices without writing anything. A preview is a question.
 */
export async function previewBatch(
  tx: TenantTransaction,
  productCode: string,
  criteria: BatchCriteria,
): Promise<BatchPreview> {
  const entityIds = await selectEntities(tx, criteria);
  const price = await resolvePrice(tx, productCode, { units: entityIds.length });
  const wallet = await getWallet(tx);
  const estimatedCost = price.unitPrice * entityIds.length;

  return {
    entities: entityIds.length,
    estimatedCost,
    unitPrice: price.unitPrice,
    exceedsBalance: estimatedCost > wallet.available,
    availableBalance: wallet.available,
  };
}

export interface CreateBatchInput {
  productCode: string;
  criteria: BatchCriteria;
  createdBy: string;
  portfolioId?: string | null;
}

export interface CreatedBatch {
  batchId: string;
  preview: BatchPreview;
}

export async function createBatch(
  tx: TenantTransaction,
  input: CreateBatchInput,
): Promise<CreatedBatch> {
  const preview = await previewBatch(tx, input.productCode, input.criteria);
  const entityIds = await selectEntities(tx, input.criteria);

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO batches (tenant_id, portfolio_id, product_code, criteria,
                          estimated_entities, estimated_cost, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::numeric, $7)
     RETURNING id`,
    [
      tx.tenantId,
      input.portfolioId ?? null,
      input.productCode,
      JSON.stringify(input.criteria),
      preview.entities,
      halalasToDecimalString(preview.estimatedCost),
      input.createdBy,
    ],
  );

  const batchId = rows[0]?.id;
  if (!batchId) {
    throw new NxError('NX-5001', { detail: 'batch insert returned no id' });
  }

  // The membership is fixed at draft time. A batch is a list of entities, not a query
  // that re-evaluates itself while it runs.
  for (const entityId of entityIds) {
    await tx.query(
      `INSERT INTO batch_items (tenant_id, batch_id, entity_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [tx.tenantId, batchId, entityId],
    );
  }

  return { batchId, preview };
}

export interface ConfirmBatchInput {
  batchId: string;
  confirmedBy: string;
  /** The figure the person was shown, in halalas. */
  acceptedCost: number;
}

/**
 * Confirms a batch against the figure that was displayed.
 *
 * If the estimate has moved since the preview, this refuses rather than running at the
 * new number. Someone agreed to a specific amount, and the system holds itself to it.
 */
export async function confirmBatch(tx: TenantTransaction, input: ConfirmBatchInput): Promise<void> {
  const { rows } = await tx.query<{
    status: BatchStatus;
    estimated_cost: string;
    created_by: string;
  }>(`SELECT status, estimated_cost, created_by FROM batches WHERE tenant_id = $1 AND id = $2`, [
    tx.tenantId,
    input.batchId,
  ]);

  const batch = rows[0];
  if (!batch) {
    throw new NxError('NX-4041', { detail: 'no such batch' });
  }
  if (batch.status !== 'DRAFT') {
    throw new NxError('NX-4002', { detail: 'only a draft batch can be confirmed' });
  }

  const estimated = riyalsToHalalas(batch.estimated_cost);
  if (estimated !== input.acceptedCost) {
    throw new NxError('NX-4002', {
      detail: 'the estimate changed since it was shown, so this needs to be previewed again',
    });
  }

  const wallet = await getWallet(tx);
  if (estimated > wallet.available) {
    // Refused before it starts rather than halfway through, so nobody is left with a
    // partly executed batch and an empty balance.
    throw new NxError('NX-4002', { detail: 'the balance does not cover this batch' });
  }

  await tx.query(
    `UPDATE batches
     SET status = 'CONFIRMED', confirmed_by = $3, confirmed_at = now(),
         confirmed_cost = $4::numeric
     WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, input.batchId, input.confirmedBy, halalasToDecimalString(estimated)],
  );

  await audit(tx, {
    actorType: 'USER',
    actorId: input.confirmedBy,
    action: 'batch.confirmed',
    target: input.batchId,
    metadata: { accepted_cost_halalas: input.acceptedCost },
  });
}

export async function cancelBatch(
  tx: TenantTransaction,
  batchId: string,
  actor: string,
): Promise<void> {
  const { rowCount } = await tx.query(
    `UPDATE batches SET status = 'CANCELLED'
     WHERE tenant_id = $1 AND id = $2 AND status IN ('DRAFT', 'CONFIRMED')`,
    [tx.tenantId, batchId],
  );

  if (rowCount === 0) {
    throw new NxError('NX-4002', { detail: 'this batch cannot be cancelled in its state' });
  }

  await audit(tx, {
    actorType: 'USER',
    actorId: actor,
    action: 'batch.cancelled',
    target: batchId,
  });
}

export interface BatchSummary {
  batchId: string;
  productCode: string;
  status: BatchStatus;
  estimatedEntities: number;
  estimatedCost: number;
  actualCost: number;
  done: number;
  failed: number;
  pending: number;
  createdBy: string;
  confirmedBy: string | null;
}

export async function getBatch(
  tx: TenantTransaction,
  batchId: string,
): Promise<BatchSummary | null> {
  const { rows } = await tx.query<{
    id: string;
    product_code: string;
    status: BatchStatus;
    estimated_entities: number;
    estimated_cost: string;
    actual_cost: string;
    created_by: string;
    confirmed_by: string | null;
    done: string;
    failed: string;
    pending: string;
  }>(
    `SELECT b.id, b.product_code, b.status, b.estimated_entities, b.estimated_cost,
            b.actual_cost, b.created_by, b.confirmed_by,
            count(*) FILTER (WHERE i.status = 'DONE')::text AS done,
            count(*) FILTER (WHERE i.status = 'FAILED')::text AS failed,
            count(*) FILTER (WHERE i.status = 'PENDING')::text AS pending
     FROM batches b
     LEFT JOIN batch_items i ON i.tenant_id = b.tenant_id AND i.batch_id = b.id
     WHERE b.tenant_id = $1 AND b.id = $2
     GROUP BY b.id`,
    [tx.tenantId, batchId],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    batchId: row.id,
    productCode: row.product_code,
    status: row.status,
    estimatedEntities: row.estimated_entities,
    estimatedCost: riyalsToHalalas(row.estimated_cost),
    actualCost: riyalsToHalalas(row.actual_cost),
    done: Number(row.done),
    failed: Number(row.failed),
    pending: Number(row.pending),
    createdBy: row.created_by,
    confirmedBy: row.confirmed_by,
  };
}

export interface PendingBatchItem {
  batchId: string;
  entityId: string;
  productCode: string;
}

export async function claimBatchItems(
  tx: TenantTransaction,
  limit = 20,
): Promise<PendingBatchItem[]> {
  const { rows } = await tx.query<{
    batch_id: string;
    entity_id: string;
    product_code: string;
  }>(
    `SELECT i.batch_id, i.entity_id, b.product_code
     FROM batch_items i
     JOIN batches b ON b.tenant_id = i.tenant_id AND b.id = i.batch_id
     WHERE i.tenant_id = $1 AND i.status = 'PENDING'
       AND b.status IN ('CONFIRMED', 'RUNNING')
     ORDER BY b.confirmed_at
     LIMIT $2
     FOR UPDATE OF i SKIP LOCKED`,
    [tx.tenantId, limit],
  );

  return rows.map((row) => ({
    batchId: row.batch_id,
    entityId: row.entity_id,
    productCode: row.product_code,
  }));
}

export async function recordBatchItem(
  tx: TenantTransaction,
  batchId: string,
  entityId: string,
  result: {
    status: 'DONE' | 'FAILED' | 'SKIPPED';
    runId?: string | null;
    cost?: number;
    errorCode?: string | null;
  },
): Promise<void> {
  await tx.query(
    `UPDATE batch_items
     SET status = $4, run_id = $5, cost = $6::numeric, error_code = $7
     WHERE tenant_id = $1 AND batch_id = $2 AND entity_id = $3`,
    [
      tx.tenantId,
      batchId,
      entityId,
      result.status,
      result.runId ?? null,
      halalasToDecimalString(result.cost ?? 0),
      result.errorCode ?? null,
    ],
  );

  await tx.query(
    `UPDATE batches
     SET status = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM batch_items
             WHERE tenant_id = $1 AND batch_id = $2 AND status = 'PENDING'
           ) THEN 'DONE'
           ELSE 'RUNNING'
         END,
         actual_cost = actual_cost + $3::numeric,
         completed_at = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM batch_items
             WHERE tenant_id = $1 AND batch_id = $2 AND status = 'PENDING'
           ) THEN now()
           ELSE completed_at
         END
     WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, batchId, halalasToDecimalString(result.cost ?? 0)],
  );
}

async function selectEntities(tx: TenantTransaction, criteria: BatchCriteria): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT e.id
     FROM entities e
     WHERE e.tenant_id = $1
       AND e.archived_at IS NULL
       AND ($2::text IS NULL OR e.entity_type = $2)
       AND ($3::uuid IS NULL OR EXISTS (
             SELECT 1 FROM portfolio_members m
             WHERE m.tenant_id = e.tenant_id AND m.entity_id = e.id AND m.portfolio_id = $3
           ))
       AND ($4::text IS NULL OR EXISTS (
             SELECT 1 FROM entity_profile p
             WHERE p.tenant_id = e.tenant_id AND p.entity_id = e.id
               AND p.field_path = $4
               AND p.observed_at < now() - make_interval(days => $5::int)
           ))
       AND ($6::text IS NULL OR NOT EXISTS (
             SELECT 1 FROM entity_profile p
             WHERE p.tenant_id = e.tenant_id AND p.entity_id = e.id AND p.field_path = $6
           ))
     ORDER BY e.last_seen_at
     LIMIT $7`,
    [
      tx.tenantId,
      criteria.entityType ?? null,
      criteria.portfolioId ?? null,
      criteria.fieldPath ?? null,
      criteria.olderThanDays ?? 0,
      criteria.missingField ?? null,
      criteria.limit ?? 1000,
    ],
  );

  return rows.map((row) => row.id);
}
