import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import type { RunStatus, StepOutcome } from './executor.js';

/**
 * Persisting a run and its steps.
 *
 * A composite product produces one run and several steps. Status, cost and billing are
 * computed per step and then rolled up, which is what makes honest partial billing
 * possible at all.
 */

export type TriggeredBy = 'API' | 'CONSOLE' | 'MONITOR' | 'BULK';

export interface RecordRunInput {
  productCode: string;
  entityId: string | null;
  clientRef?: string | null;
  idempotencyKey?: string | null;
  modeAtExecution: 'MANAGED' | 'BYOC';
  providerUsed?: string | null;
  status: RunStatus;
  latencyMs: number;
  triggeredBy: TriggeredBy;
  steps: readonly StepOutcome[];
}

export interface RecordedRun {
  runId: string;
  status: RunStatus;
}

export async function recordRun(
  tx: TenantTransaction,
  input: RecordRunInput,
): Promise<RecordedRun> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO verification_runs
       (tenant_id, product_code, entity_id, client_ref, idempotency_key, mode_at_execution,
        provider_used, status, latency_ms, triggered_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      tx.tenantId,
      input.productCode,
      input.entityId,
      input.clientRef ?? null,
      input.idempotencyKey ?? null,
      input.modeAtExecution,
      input.providerUsed ?? null,
      input.status,
      input.latencyMs,
      input.triggeredBy,
    ],
  );

  const runId = rows[0]?.id;
  if (!runId) {
    throw new NxError('NX-5001', { detail: 'run insert returned no id' });
  }

  for (const step of input.steps) {
    await tx.query(
      `INSERT INTO run_steps
         (tenant_id, run_id, step_key, provider, endpoint, status, served_from_cache,
          latency_ms, billable, billed_amount, provider_cost, error_code, skipped_because)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        tx.tenantId,
        runId,
        step.stepKey,
        step.provider,
        step.endpoint,
        step.status,
        step.servedFromCache,
        step.latencyMs,
        step.billable,
        // Pricing lands in unit 6. Until then a step records what it may be billed, and
        // a step that never ran records zero, which the database also enforces.
        step.billable ? null : 0,
        step.providerCost ?? null,
        step.errorCode ?? null,
        step.skippedBecause ?? null,
      ],
    );
  }

  return { runId, status: input.status };
}

export interface StoredRunStep {
  stepKey: string;
  status: string;
  provider: string;
  endpoint: string;
  billable: boolean;
  billedAmount: number | null;
  skippedBecause: string | null;
  errorCode: string | null;
}

export interface StoredRun {
  runId: string;
  productCode: string;
  entityId: string | null;
  status: string;
  decision: string | null;
  clientRef: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  steps: StoredRunStep[];
}

export async function getRun(tx: TenantTransaction, runId: string): Promise<StoredRun | null> {
  const { rows } = await tx.query<{
    id: string;
    product_code: string;
    entity_id: string | null;
    status: string;
    decision: string | null;
    client_ref: string | null;
    idempotency_key: string | null;
    created_at: Date;
  }>(
    `SELECT id, product_code, entity_id, status, decision, client_ref, idempotency_key, created_at
     FROM verification_runs
     WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, runId],
  );

  const run = rows[0];
  if (!run) {
    return null;
  }

  const { rows: steps } = await tx.query<{
    step_key: string;
    status: string;
    provider: string;
    endpoint: string;
    billable: boolean;
    billed_amount: string | null;
    skipped_because: string | null;
    error_code: string | null;
  }>(
    `SELECT step_key, status, provider, endpoint, billable, billed_amount,
            skipped_because, error_code
     FROM run_steps
     WHERE tenant_id = $1 AND run_id = $2
     ORDER BY created_at, step_key`,
    [tx.tenantId, runId],
  );

  return {
    runId: run.id,
    productCode: run.product_code,
    entityId: run.entity_id,
    status: run.status,
    decision: run.decision,
    clientRef: run.client_ref,
    idempotencyKey: run.idempotency_key,
    createdAt: run.created_at,
    steps: steps.map((step) => ({
      stepKey: step.step_key,
      status: step.status,
      provider: step.provider,
      endpoint: step.endpoint,
      billable: step.billable,
      billedAmount: step.billed_amount === null ? null : Number(step.billed_amount),
      skippedBecause: step.skipped_because,
      errorCode: step.error_code,
    })),
  };
}

export async function findRunByIdempotencyKey(
  tx: TenantTransaction,
  idempotencyKey: string,
): Promise<StoredRun | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM verification_runs WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tx.tenantId, idempotencyKey],
  );
  const runId = rows[0]?.id;
  return runId ? getRun(tx, runId) : null;
}
