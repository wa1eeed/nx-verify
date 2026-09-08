import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { requireProduct } from '../products/catalog.js';
import { assertValidSubject } from '../products/input-validation.js';
import { executeProduct, type StepRunner } from '../orchestration/executor.js';
import {
  closeRun,
  getRun,
  openRun,
  type StoredRun,
  type TriggeredBy,
} from '../orchestration/run-recorder.js';
import { normaliseRun, type NormaliseResult } from '../normalisation/normalise.js';
import { resolveEntity, type IdentifierInput } from '../repositories/entities.js';
import { computeBilling, maximumCharge, type BillingBreakdown } from '../billing/compute.js';
import { resolvePrice } from '../billing/price-book.js';
import { hold, releaseHold, settle } from '../billing/wallet.js';
import { toPublicResults, type PublicResults } from '../public-view.js';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';

/**
 * One verification, from request to settled charge.
 *
 * The order of the steps below is the whole point, and each one is there because of a
 * specific way this goes wrong otherwise:
 *
 *   1. Claim the idempotency key first, by inserting a PENDING run. A duplicate then
 *      loses at the unique index and never reaches a provider. Checking first and
 *      inserting later leaves a window where two requests both see nothing and both
 *      charge (rule 7).
 *   2. Validate the subject before reserving or calling anything, so a malformed request
 *      costs nothing.
 *   3. Reserve the worst case, so a run cannot drive the balance negative halfway through.
 *   4. Execute, normalise, then settle the real amount and release the reservation.
 *
 * A replay does none of steps 2 to 4. It returns the stored run, which is what "same key,
 * same result, one charge" means.
 */

export interface VerifyInput {
  productCode: string;
  subject: Readonly<Record<string, unknown>>;
  /** How the subject entity is resolved or created. */
  subjectIdentifiers: IdentifierInput[];
  subjectDisplayName?: string | undefined;
  idempotencyKey?: string | null;
  clientRef?: string | null;
  triggeredBy: TriggeredBy;
  modeAtExecution: 'MANAGED' | 'BYOC';
  runStep: StepRunner;
  keys: TenantKeyProvider;
  contractId?: string | null;
}

export interface VerifyResult {
  runId: string;
  status: string;
  entityId: string | null;
  results: PublicResults;
  billing: { amount: number; currency: string };
  normalised: NormaliseResult | null;
  breakdown: BillingBreakdown | null;
  /** True when this request replayed an earlier run under the same key. */
  replayed: boolean;
}

export async function verify(tx: TenantTransaction, input: VerifyInput): Promise<VerifyResult> {
  const product = await requireProduct(tx, input.productCode);

  // Validate before anything is reserved or claimed. A 422 must cost nothing.
  assertValidSubject(product.code, product.inputSchema, input.subject);

  const subject = await resolveEntity(tx, input.keys, {
    entityType: product.subjectType,
    identifiers: input.subjectIdentifiers,
    displayName: input.subjectDisplayName,
  });

  const opened = await openRun(tx, {
    productCode: product.code,
    entityId: subject.entityId,
    clientRef: input.clientRef ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    modeAtExecution: input.modeAtExecution,
    triggeredBy: input.triggeredBy,
  });

  if (opened.kind === 'replayed') {
    return replayed(opened.run);
  }

  const runId = opened.runId;
  const price = await resolvePrice(tx, product.code, {
    contractId: input.contractId ?? null,
  });
  const reserved = maximumCharge(price);
  await hold(tx, reserved);

  let outcome;
  try {
    outcome = await executeProduct({ product, subject: input.subject, runStep: input.runStep });
  } catch (error) {
    // Nothing ran, so nothing is owed.
    await releaseHold(tx, runId, reserved);
    await closeRun(tx, { runId, status: 'ERROR', latencyMs: 0, steps: [] });
    throw error;
  }

  const breakdown = computeBilling(outcome.steps, price);
  const charges = new Map(breakdown.steps.map((step) => [step.stepKey, step.amount]));

  await closeRun(tx, {
    runId,
    status: outcome.status,
    latencyMs: outcome.latencyMs,
    steps: outcome.steps,
    charges,
    billedAmount: breakdown.total,
  });

  const normalised = await normaliseRun(tx, input.keys, {
    productCode: product.code,
    subjectEntityId: subject.entityId,
    runId,
    steps: outcome.steps,
  });

  await settle(tx, { runId, heldAmount: reserved, chargeAmount: breakdown.total });

  return {
    runId,
    status: outcome.status,
    entityId: subject.entityId,
    results: toPublicResults(outcome.steps),
    billing: { amount: breakdown.total, currency: 'SAR' },
    normalised,
    breakdown,
    replayed: false,
  };
}

function replayed(run: StoredRun): VerifyResult {
  const results: PublicResults = {};
  for (const step of run.steps) {
    results[step.stepKey] = {
      status: step.status as PublicResults[string]['status'],
      ...(step.skippedBecause ? { reason: step.skippedBecause } : {}),
    };
  }

  return {
    runId: run.runId,
    status: run.status,
    entityId: run.entityId,
    results,
    billing: {
      amount: run.steps.reduce((sum, step) => sum + Math.round((step.billedAmount ?? 0) * 100), 0),
      currency: 'SAR',
    },
    normalised: null,
    breakdown: null,
    replayed: true,
  };
}

/** Reads back a completed run, for the replay path and for the console. */
export async function getVerification(
  tx: TenantTransaction,
  runId: string,
): Promise<StoredRun | null> {
  const run = await getRun(tx, runId);
  if (!run) {
    return null;
  }
  return run;
}

export function assertBillingIsSane(breakdown: BillingBreakdown): void {
  if (breakdown.total > breakdown.unitPrice) {
    // Apportioning by weight can never exceed the product price. If it did, a customer
    // would be charged more for a partial result than for a complete one.
    throw new NxError('NX-5001', { detail: 'apportioned charge exceeded the product price' });
  }
}
