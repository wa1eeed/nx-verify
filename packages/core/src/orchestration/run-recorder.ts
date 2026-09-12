import { withSavepoint, type TenantTransaction } from '@nx-verify/db';
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

export interface OpenRunInput {
  productCode: string;
  entityId: string | null;
  clientRef?: string | null;
  idempotencyKey?: string | null;
  modeAtExecution: 'MANAGED' | 'BYOC';
  triggeredBy: TriggeredBy;
}

export type OpenRunOutcome =
  { kind: 'opened'; runId: string } | { kind: 'replayed'; run: StoredRun };

/**
 * Claims the idempotency key before anything is called.
 *
 * Rule 7. The key is reserved by inserting a PENDING run, so a duplicate request loses
 * the race at the unique index and never reaches a provider. Checking for an existing
 * run first and inserting afterwards would leave a window in which two concurrent
 * requests both see nothing, both call the provider, and both charge.
 */
export async function openRun(tx: TenantTransaction, input: OpenRunInput): Promise<OpenRunOutcome> {
  try {
    const rows = await withSavepoint(tx, async () => {
      const result = await tx.query<{ id: string }>(
        `INSERT INTO verification_runs
           (tenant_id, product_code, entity_id, client_ref, idempotency_key,
            mode_at_execution, status, triggered_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)
         RETURNING id`,
        [
          tx.tenantId,
          input.productCode,
          input.entityId,
          input.clientRef ?? null,
          input.idempotencyKey ?? null,
          input.modeAtExecution,
          input.triggeredBy,
        ],
      );
      return result.rows;
    });

    const runId = rows[0]?.id;
    if (!runId) {
      throw new NxError('NX-5001', { detail: 'run insert returned no id' });
    }
    return { kind: 'opened', runId };
  } catch (error) {
    if (!isUniqueViolation(error) || !input.idempotencyKey) {
      throw error;
    }
    const existing = await findRunByIdempotencyKey(tx, input.idempotencyKey);
    if (!existing) {
      throw error;
    }
    return { kind: 'replayed', run: existing };
  }
}

export interface StepCharge {
  stepKey: string;
  /** In halalas. Zero for a step that did not run. */
  amount: number;
}

export interface CloseRunInput {
  runId: string;
  status: RunStatus;
  latencyMs: number;
  providerUsed?: string | null;
  decision?: 'PASS' | 'FAIL' | 'REVIEW' | null;
  decisionReasons?: unknown;
  steps: readonly StepOutcome[];
  /** Per step charges in halalas, keyed by step_key. Absent means zero. */
  charges?: ReadonlyMap<string, number>;
  billedAmount?: number;
  providerCost?: number;
  /** Where this run was paid from: the package's capacity, the wallet, or nowhere. */
  chargeSource?: 'PACKAGE' | 'WALLET' | 'FREE';
}

/**
 * A reference a person can read out loud.
 *
 * Allocated per subscriber and at the end of the run rather than the start, so the row
 * lock on the counter is held for the shortest part of the transaction, and so a request
 * that never became a verification never consumes a number: gaps in a sequence a customer
 * can see are questions we would have to answer.
 */
export async function allocateReference(tx: TenantTransaction, at = new Date()): Promise<string> {
  const year = at.getUTCFullYear();
  const { rows } = await tx.query<{ next_value: number }>(
    `INSERT INTO run_counters (tenant_id, year, next_value)
     VALUES ($1, $2, 2)
     ON CONFLICT (tenant_id, year) DO UPDATE SET next_value = run_counters.next_value + 1
     RETURNING CASE WHEN run_counters.next_value IS NULL THEN 1 ELSE run_counters.next_value - 1 END
               AS next_value`,
    [tx.tenantId, year],
  );

  const number = rows[0]?.next_value ?? 1;
  return `VRF-${year}-${String(number).padStart(6, '0')}`;
}

export async function closeRun(tx: TenantTransaction, input: CloseRunInput): Promise<string> {
  const billed = input.billedAmount ?? 0;
  const reference = await allocateReference(tx);

  await tx.query(
    `UPDATE verification_runs
     SET status = $3, latency_ms = $4, provider_used = $5, decision = $6,
         decision_reasons = $7::jsonb, billed_amount = $8::numeric,
         provider_cost = $9::numeric, billable = $10,
         charge_source = $11, reference = coalesce(reference, $12)
     WHERE tenant_id = $1 AND id = $2`,
    [
      tx.tenantId,
      input.runId,
      input.status,
      input.latencyMs,
      input.providerUsed ?? null,
      input.decision ?? null,
      input.decisionReasons === undefined ? null : JSON.stringify(input.decisionReasons),
      decimal(billed),
      input.providerCost === undefined ? null : decimal(input.providerCost),
      billed > 0,
      input.chargeSource ?? 'WALLET',
      reference,
    ],
  );

  for (const step of input.steps) {
    const amount = input.charges?.get(step.stepKey) ?? 0;
    await tx.query(
      `INSERT INTO run_steps
         (tenant_id, run_id, step_key, provider, endpoint, status, served_from_cache,
          latency_ms, billable, billed_amount, provider_cost, error_code, skipped_because)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11::numeric, $12, $13)
       ON CONFLICT (tenant_id, run_id, step_key) DO NOTHING`,
      [
        tx.tenantId,
        input.runId,
        step.stepKey,
        step.provider,
        step.endpoint,
        step.status,
        step.servedFromCache,
        step.latencyMs,
        // A step that never ran, and a step that errored, are never billable. The
        // database refuses the alternative through ck_skipped_not_billed.
        amount > 0,
        decimal(amount),
        step.providerCost === undefined ? null : decimal(step.providerCost * 100),
        step.errorCode ?? null,
        step.skippedBecause ?? null,
      ],
    );
  }

  return reference;
}

function decimal(halalas: number): string {
  const rounded = Math.round(halalas);
  const sign = rounded < 0 ? '-' : '';
  const absolute = Math.abs(rounded);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

/** Opens and closes a run in one call, for callers that have already executed it. */
export async function recordRun(
  tx: TenantTransaction,
  input: RecordRunInput,
): Promise<RecordedRun> {
  const opened = await openRun(tx, {
    productCode: input.productCode,
    entityId: input.entityId,
    clientRef: input.clientRef ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    modeAtExecution: input.modeAtExecution,
    triggeredBy: input.triggeredBy,
  });

  if (opened.kind === 'replayed') {
    return { runId: opened.run.runId, status: input.status };
  }

  await closeRun(tx, {
    runId: opened.runId,
    status: input.status,
    latencyMs: input.latencyMs,
    providerUsed: input.providerUsed ?? null,
    steps: input.steps,
  });

  return { runId: opened.runId, status: input.status };
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
  /** The number a person reads out loud, such as VRF-2026-000019. */
  reference: string | null;
  /** Where this run was paid from: the package, the wallet, or the free window. */
  chargeSource: string;
  productCode: string;
  entityId: string | null;
  status: string;
  decision: string | null;
  decisionReasons: { code: string; message_ar: string; message_en: string }[];
  clientRef: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  steps: StoredRunStep[];
}

export async function getRun(tx: TenantTransaction, runId: string): Promise<StoredRun | null> {
  const { rows } = await tx.query<{
    id: string;
    reference: string | null;
    charge_source: string;
    product_code: string;
    entity_id: string | null;
    status: string;
    decision: string | null;
    decision_reasons: { code: string; message_ar: string; message_en: string }[] | null;
    client_ref: string | null;
    idempotency_key: string | null;
    created_at: Date;
  }>(
    `SELECT id, reference, charge_source, product_code, entity_id, status, decision, decision_reasons,
            client_ref, idempotency_key, created_at
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
    reference: run.reference,
    chargeSource: run.charge_source,
    productCode: run.product_code,
    entityId: run.entity_id,
    status: run.status,
    decision: run.decision,
    decisionReasons: run.decision_reasons ?? [],
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
