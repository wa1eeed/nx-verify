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
import { computeScore, storeScore } from '../monitoring/scoring.js';
import { resolveRuleset } from '../portfolios/portfolios.js';
import { resolveEntity, type IdentifierInput } from '../repositories/entities.js';
import { computeBilling, maximumCharge, type BillingBreakdown } from '../billing/compute.js';
import { resolvePrice } from '../billing/price-book.js';
import { recordMargin } from '../billing/margin.js';
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
import { loadWait, markResumed, openWaits } from './waits.js';

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
  /**
   * Which environment this run belongs to, so a callback can be matched back to it.
   *
   * Only consulted when a step reports that it is waiting. A sandbox delivery must never
   * resume a production run, and the pair of provider and environment is what keeps them
   * apart.
   */
  environment?: 'sandbox' | 'live';
  /** How long a provider is given to call back before the run is closed unanswered. */
  awaitTtlSeconds?: number;
}

export interface VerifyResult {
  runId: string;
  /** The number a person reads out loud, such as VRF-2026-000019. */
  reference: string | null;
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
  const entitlement = await resolveEntitlement(tx, product.code);
  assertEntitled(entitlement);

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
  const bookPrice = await resolvePrice(tx, product.code, {
    contractId: input.contractId ?? null,
  });

  /**
   * Which price applies, by the same rule the entitlement follows: the narrowest one that
   * mentions this product wins. An exception written for this subscriber, then the plan,
   * then the price book.
   *
   * Without this the negotiated figures in a plan or an exception would be numbers that
   * are stored, shown on an operator screen, and never charged, which is worse than not
   * having them.
   */
  const listPrice =
    entitlement.unitPriceHalalas === null
      ? bookPrice
      : { ...bookPrice, unitPrice: entitlement.unitPriceHalalas };

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

  /**
   * Where this run is paid from.
   *
   * A package sells capacity and a wallet holds credit. A run inside the capacity was
   * bought when the commitment was signed, so it moves no money: charging the wallet as
   * well would make the customer pay for it twice, and the package a limit rather than a
   * purchase. Past the capacity, or with no capacity at all, the wallet pays.
   */
  const withinCapacity =
    commitment !== null &&
    commitment.includedTransactions !== null &&
    commitment.transactionsUsed < commitment.includedTransactions;

  const chargeSource: 'PACKAGE' | 'WALLET' | 'FREE' = free
    ? 'FREE'
    : withinCapacity
      ? 'PACKAGE'
      : 'WALLET';

  // The price is still computed and still recorded, whoever pays: a statement that cannot
  // say what a package covered is a statement that cannot show what the package is worth.
  const price = free ? { ...listPrice, unitPrice: 0 } : listPrice;
  const reserved = chargeSource === 'WALLET' ? maximumCharge(price) : 0;
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

  if (outcome.status === 'AWAITING') {
    /**
     * The provider took the request and will answer later.
     *
     * Nothing settles here, and that is the whole guarantee: the hold is released, no
     * charge is written, no usage is counted. A customer must not pay twice because the
     * answer arrived in two parts, and settling once at the end is how that is ensured
     * rather than promised.
     */
    await releaseHold(tx, runId, reserved);
    const reference = await closeRun(tx, {
      runId,
      status: 'AWAITING',
      latencyMs: outcome.latencyMs,
      steps: outcome.steps,
    });

    await openWaits(tx, {
      keys: input.keys,
      runId,
      provider: outcome.steps.find((step) => step.status === 'AWAITING')?.provider ?? 'unknown',
      environment: input.environment ?? 'live',
      subject: input.subject,
      awaiting: outcome.awaiting ?? [],
      ttlSeconds: input.awaitTtlSeconds ?? DEFAULT_AWAIT_TTL_SECONDS,
    });

    // Said out loud rather than left for the customer to discover by polling. A run that
    // goes quiet for an hour and then completes looks like a fault while it is quiet.
    await queueEvent(tx, {
      eventType: 'verification.awaiting',
      payload: {
        verification_id: runId,
        product: product.code,
        entity_id: subject.entityId,
        client_ref: input.clientRef ?? null,
      },
    });

    return {
      runId,
      reference,
      status: 'AWAITING',
      entityId: subject.entityId,
      results: toPublicResults(outcome.steps),
      decision: null,
      billing: { amount: 0, currency: 'SAR' },
      normalised: null,
      breakdown: null,
      replayed: false,
    };
  }

  return concludeRun(tx, {
    runId,
    product,
    subject: subject.entityId,
    outcome,
    price,
    chargeSource,
    reserved,
    keys: input.keys,
    clientRef: input.clientRef ?? null,
    triggeredBy: input.triggeredBy,
  });
}

/** A provider gets a day to answer before the run is closed as unanswered. */
export const DEFAULT_AWAIT_TTL_SECONDS = 24 * 60 * 60;

interface ConcludeInput {
  runId: string;
  product: Awaited<ReturnType<typeof requireProduct>>;
  /** The subject entity, already resolved. */
  subject: string;
  outcome: Awaited<ReturnType<typeof executeProduct>>;
  price: Awaited<ReturnType<typeof resolvePrice>>;
  chargeSource: 'PACKAGE' | 'WALLET' | 'FREE';
  reserved: number;
  keys: TenantKeyProvider;
  clientRef: string | null;
  triggeredBy: TriggeredBy;
}

/**
 * Everything after the provider has answered: bill, record, decide, settle, announce.
 *
 * Split out so that a run resumed by a callback goes through exactly this code and not a
 * second copy of it. A second copy is how a resumed run ends up billed by a different
 * rule from a direct one, and nobody notices until a customer compares two invoices.
 */
async function concludeRun(tx: TenantTransaction, input: ConcludeInput): Promise<VerifyResult> {
  const { runId, product, outcome, price, chargeSource, reserved } = input;

  const breakdown = computeBilling(outcome.steps, price);
  const charges = new Map(breakdown.steps.map((step) => [step.stepKey, step.amount]));

  const reference = await closeRun(tx, {
    runId,
    status: outcome.status,
    latencyMs: outcome.latencyMs,
    steps: outcome.steps,
    charges,
    billedAmount: breakdown.total,
    chargeSource,
  });

  const normalised = await normaliseRun(tx, input.keys, {
    productCode: product.code,
    subjectEntityId: input.subject,
    runId,
    steps: outcome.steps,
  });

  /**
   * The score, recomputed over the profile this run just changed.
   *
   * Stored rather than left to be worked out on every read. A list of a hundred customers
   * cannot run a hundred scoring queries to draw itself, and a column that says "no score"
   * for every row because nothing ever wrote one is a column that should not be there.
   *
   * It is a snapshot at the moment of the run and says so on screen. Freshness keeps
   * moving afterwards without anybody calling anything, which is why the list shows the
   * freshness state beside the score rather than instead of it.
   */
  if (input.subject !== '') {
    await storeScore(tx, await computeScore(tx, input.subject));
  }

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
          input.subject,
          await resolveRuleset(tx, input.subject, product.decisionRuleset),
        );
  if (decision) {
    await storeDecision(tx, runId, decision);

    // A REVIEW that opens no case is a REVIEW nobody does. This is what makes the
    // outcome a piece of work rather than a label on a response.
    if (decision.outcome === 'REVIEW') {
      await openCase(tx, {
        entityId: input.subject,
        runId,
        reasonCodes: decision.reasons.map((reason) => reason.code),
      });
    }
  }

  // Nothing to settle when the package or the free window paid: no money was reserved
  // and none is owed.
  await settle(tx, {
    runId,
    heldAmount: reserved,
    chargeAmount: chargeSource === 'WALLET' ? breakdown.total : 0,
  });

  // Counted once the run is real. A replay returned above never reaches this line, which
  // is rule 7 expressed in the other currency a package is measured in.
  await recordUsage(tx, product.code);

  // And counted again in the one shape an internal role may read: a month, a product, a
  // count and two sums, with nothing in it about whom this was.
  await recordMargin(tx, {
    productCode: product.code,
    billedHalalas: chargeSource === 'WALLET' ? breakdown.total : 0,
    providerCostHalalas: outcome.steps.reduce(
      (total, step) => total + Math.round((step.providerCost ?? 0) * 100),
      0,
    ),
    coveredByPackage: chargeSource === 'PACKAGE',
  });

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
      entity_id: input.subject,
      client_ref: input.clientRef,
      triggered_by: input.triggeredBy,
    },
  });

  return {
    runId,
    reference,
    status: outcome.status,
    entityId: input.subject,
    results: toPublicResults(outcome.steps),
    decision,
    billing: { amount: breakdown.total, currency: 'SAR' },
    normalised,
    breakdown,
    replayed: false,
  };
}

export interface ResumeInput {
  waitId: string;
  runStep: StepRunner;
  keys: TenantKeyProvider;
  contractId?: string | null;
}

/**
 * Runs an awaiting verification to its end, now that the provider has answered.
 *
 * The whole product is executed again rather than only the step that was waiting. Two
 * reasons, and the second is the one that matters. Step level caching already prevents a
 * re-run from calling anything twice inside its window, so the cost is small. And the
 * run has not settled, so billing, normalisation, the decision and the event all happen
 * once, here, through the same code a direct run goes through. Resuming into a half
 * settled run is how a customer ends up charged twice for one verification.
 */
export async function resumeRun(
  tx: TenantTransaction,
  input: ResumeInput,
): Promise<VerifyResult | null> {
  const wait = await loadWait(tx, input.keys, input.waitId);

  const stored = await getRun(tx, wait.runId);
  if (!stored) {
    throw new NxError('NX-4041', { detail: 'the run this callback belongs to is gone' });
  }
  if (stored.status !== 'AWAITING') {
    // Already concluded, by an earlier delivery or by expiry. Nothing to do, and doing
    // it anyway would charge a settled run a second time.
    await markResumed(tx, wait.waitId);
    return null;
  }

  const product = await requireProduct(tx, stored.productCode);
  const entitlement = await resolveEntitlement(tx, product.code);
  assertEntitled(entitlement);

  const bookPrice = await resolvePrice(tx, product.code, { contractId: input.contractId ?? null });
  const price =
    entitlement.unitPriceHalalas === null
      ? bookPrice
      : { ...bookPrice, unitPrice: entitlement.unitPriceHalalas };

  const commitment = await getCommitment(tx);
  const withinCapacity =
    commitment !== null &&
    commitment.includedTransactions !== null &&
    commitment.transactionsUsed < commitment.includedTransactions;
  const chargeSource: 'PACKAGE' | 'WALLET' = withinCapacity ? 'PACKAGE' : 'WALLET';

  const reserved = chargeSource === 'WALLET' ? maximumCharge(price) : 0;
  await hold(tx, reserved);

  let outcome;
  try {
    outcome = await executeProduct({
      product,
      subject: wait.subject,
      runStep: input.runStep,
    });
  } catch (error) {
    await releaseHold(tx, wait.runId, reserved);
    await closeRun(tx, { runId: wait.runId, status: 'ERROR', latencyMs: 0, steps: [] });
    await markResumed(tx, wait.waitId);
    throw error;
  }

  if (outcome.status === 'AWAITING') {
    // Still not ready. The provider sent something, and it was not the answer. The wait
    // is left to its original deadline rather than extended, so a provider that keeps
    // sending nothing useful cannot keep a run open for ever.
    await releaseHold(tx, wait.runId, reserved);
    await tx.query(`UPDATE run_waits SET status = 'WAITING', resolved_at = NULL WHERE id = $1`, [
      wait.waitId,
    ]);
    return null;
  }

  await markResumed(tx, wait.waitId);

  return concludeRun(tx, {
    runId: wait.runId,
    product,
    subject: stored.entityId ?? '',
    outcome,
    price,
    chargeSource,
    reserved,
    keys: input.keys,
    clientRef: stored.clientRef ?? null,
    triggeredBy: stored.triggeredBy,
  });
}

/**
 * Closes a run whose provider never answered.
 *
 * An error, and never billed. A run left open for ever is worse than one that failed: the
 * customer is told nothing and keeps a case open against an answer that is not coming.
 */
export async function abandonRun(tx: TenantTransaction, runId: string): Promise<void> {
  const stored = await getRun(tx, runId);
  if (!stored || stored.status !== 'AWAITING') {
    return;
  }
  await closeRun(tx, { runId, status: 'ERROR', latencyMs: 0, steps: [] });
  await queueEvent(tx, {
    eventType: 'verification.completed',
    payload: {
      verification_id: runId,
      product: stored.productCode,
      status: 'ERROR',
      decision: null,
      entity_id: stored.entityId,
      client_ref: stored.clientRef ?? null,
      triggered_by: stored.triggeredBy,
    },
  });
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
    reference: run.reference,
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
