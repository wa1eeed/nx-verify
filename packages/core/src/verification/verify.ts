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
import { queueEvent } from '../webhooks/dispatch.js';
import { decide, storeDecision, type Decision } from '../decision/engine.js';
import { openCase } from '../review/queue.js';
import { resolveRuleset } from '../portfolios/portfolios.js';
import { resolveEntity, type IdentifierInput } from '../repositories/entities.js';
import { computeBilling, maximumCharge, type BillingBreakdown } from '../billing/compute.js';
import { resolvePrice } from '../billing/price-book.js';
import {
  assertEntitled,
  getCommitment,
  isFreeReverification,
  recordUsage,
  resolveEntitlement,
} from '../billing/entitlements.js';
import { hold, releaseHold, settle } from '../billing/wallet.js';
import { toPublicResults, type PublicResults } from '../public-view.js';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';

/**
 * One verification, from request to settled charge.
 *
 * The order of the steps below is the whole point, and each one is there because of a
 * specific way this goes wrong otherwise:
 *
 *   0. Check the subscriber is entitled to this product, before the key is claimed and
 *      before anything is reserved. A module the customer did not buy must cost them
 *      nothing and leave no run behind (ADR-061).
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
  decision: Decision | null;
  billing: { amount: number; currency: string };
  normalised: NormaliseResult | null;
  breakdown: BillingBreakdown | null;
  /** True when this request replayed an earlier run under the same key. */
  replayed: boolean;
}

export async function verify(tx: TenantTransaction, input: VerifyInput): Promise<VerifyResult> {
  const product = await requireProduct(tx, input.productCode);

  // Before anything else, including the idempotency claim: a product the subscriber's
  // package does not include never becomes a run, never reserves, and never charges.
  assertEntitled(await resolveEntitlement(tx, product.code));

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
  const listPrice = await resolvePrice(tx, product.code, {
    contractId: input.contractId ?? null,
  });

  // Practice four in the blueprint's competitive list: re-verifying the same entity with
  // the same product inside the plan's window costs nothing. It is priced at zero rather
  // than refunded afterwards, so the hold, the settlement and the invoice all agree.
  //
  // Monitoring is excluded, and that is not an oversight. Monitoring is a priced component
  // with a budget of its own, and a sweep that re-checks the same entity every few days
  // would be free under this rule, which would make the budget a number that means
  // nothing. The promise is about a person re-running a check, not about our own sweep.
  const commitment = input.triggeredBy === 'MONITOR' ? null : await getCommitment(tx);
  const free =
    commitment !== null &&
    (await isFreeReverification(tx, {
      entityId: subject.entityId,
      productCode: product.code,
      withinDays: commitment.freeReverifyDays,
    }));

  const price = free ? { ...listPrice, unitPrice: 0 } : listPrice;
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

  // The decision runs after normalisation, over the profile as it now stands rather than
  // over this run's steps alone. A verification that confirms two fields is judged
  // against everything known about the entity, which is the difference between a lookup
  // service and a compliance layer.
  const decision =
    outcome.status === 'ERROR'
      ? null
      : // A portfolio's rules beat the product's, because the portfolio is where the
        // purpose lives: the same check means one thing when onboarding a merchant and
        // another when paying out to a beneficiary.
        await decide(
          tx,
          subject.entityId,
          await resolveRuleset(tx, subject.entityId, product.decisionRuleset),
        );
  if (decision) {
    await storeDecision(tx, runId, decision);

    // A REVIEW that opens no case is a REVIEW nobody does. This is what makes the
    // outcome a piece of work rather than a label on a response.
    if (decision.outcome === 'REVIEW') {
      await openCase(tx, {
        entityId: subject.entityId,
        runId,
        reasonCodes: decision.reasons.map((reason) => reason.code),
      });
    }
  }

  await settle(tx, { runId, heldAmount: reserved, chargeAmount: breakdown.total });

  // Counted once the run is real. A replay returned above never reaches this line, which
  // is rule 7 expressed in the other currency a package is measured in.
  await recordUsage(tx, product.code);

  // Announced here rather than by the caller, so that a run started by a monitor, a
  // batch or the console emits the same event as one started through the API. An event
  // that only fires on one path is worse than none, because the customer builds on it.
  await queueEvent(tx, {
    eventType: 'verification.completed',
    payload: {
      verification_id: runId,
      product: product.code,
      status: outcome.status,
      decision: decision?.outcome ?? null,
      entity_id: subject.entityId,
      client_ref: input.clientRef ?? null,
      triggered_by: input.triggeredBy,
    },
  });

  return {
    runId,
    status: outcome.status,
    entityId: subject.entityId,
    results: toPublicResults(outcome.steps),
    decision,
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
    // Rule 7 covers the decision too. The same key returns the same answer, and the
    // answer is not only the status.
    decision:
      run.decision === null
        ? null
        : {
            outcome: run.decision as Decision['outcome'],
            reasons: run.decisionReasons.map((reason) => ({
              code: reason.code,
              messageAr: reason.message_ar,
              messageEn: reason.message_en,
            })),
            matchedSeq: null,
            rulesetId: null,
          },
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
