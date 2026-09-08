import { NxError } from '../errors.js';
import { assertValidSubject } from '../products/input-validation.js';
import { resolveBinding } from './binding.js';
import { collectDependants, planExecution } from './plan.js';
import type { ProductDefinition, ProductStepDefinition } from '../products/catalog.js';
import type { PublicStepStatus } from '../public-view.js';

/**
 * The step orchestrator, following docs/03-products.md section 5.
 *
 * Two rules shape everything here.
 *
 * A step that never ran is never billed. When a step fails, every step that depends on
 * it, directly or transitively, is marked SKIPPED with billable false. Charging for work
 * that did not happen is the fastest route to a billing dispute, and the database refuses
 * it too through ck_skipped_not_billed.
 *
 * A failure is not the same as an absence. NOT_FOUND means the authority answered and the
 * subject is not there, which is a real result and is billed at a reduced rate. ERROR
 * means we never got an answer, and it is never billed.
 */

export type RunStatus = 'OK' | 'PARTIAL' | 'NOT_FOUND' | 'ERROR';

export interface StepOutcome {
  stepKey: string;
  status: PublicStepStatus;
  provider: string;
  endpoint: string;
  authority: string | null;
  data: Readonly<Record<string, unknown>> | null;
  latencyMs: number;
  errorCode?: string | undefined;
  skippedBecause?: string | undefined;
  servedFromCache: boolean;
  billable: boolean;
  providerCost?: number | undefined;
  stepWeight: number;
  required: boolean;
}

export interface ExecutionOutcome {
  status: RunStatus;
  steps: StepOutcome[];
  latencyMs: number;
}

/**
 * Runs one step. Supplied by the caller so that the orchestrator depends on no provider
 * package: packages/core must not import packages/providers (ADR-006).
 */
export type StepRunner = (
  step: ProductStepDefinition,
  request: Readonly<Record<string, unknown>>,
) => Promise<{
  outcome: 'OK' | 'NOT_FOUND' | 'ERROR';
  authority: string | null;
  data: Readonly<Record<string, unknown>> | null;
  latencyMs: number;
  errorCode?: string | undefined;
  providerCost?: number | undefined;
  servedFromCache?: boolean | undefined;
  providerUsed?: string | undefined;
}>;

export interface ExecuteProductInput {
  product: ProductDefinition;
  subject: Readonly<Record<string, unknown>>;
  runStep: StepRunner;
}

export async function executeProduct(input: ExecuteProductInput): Promise<ExecutionOutcome> {
  const { product, subject, runStep } = input;
  const startedAt = Date.now();

  // Step 1: validate before anything is called, so a bad request costs nothing.
  assertValidSubject(product.code, product.inputSchema, subject);

  if (product.steps.length === 0) {
    throw new NxError('NX-5001', { detail: 'product defines no steps' });
  }

  const plan = planExecution(product.steps);
  const outputs: Record<string, Readonly<Record<string, unknown>> | null> = {};
  const results = new Map<string, StepOutcome>();
  const skipped = new Map<string, string>();

  for (const wave of plan.waves) {
    const pending = wave.filter((step) => !skipped.has(step.stepKey));

    for (const step of wave) {
      const reason = skipped.get(step.stepKey);
      if (reason !== undefined) {
        results.set(step.stepKey, skippedOutcome(step, reason));
        outputs[step.stepKey] = null;
      }
    }

    // Independent steps run together. A composite product then takes as long as its
    // longest chain instead of the sum of its steps.
    const executed = await Promise.all(
      pending.map(async (step) => {
        const request = resolveBinding(step.inputBinding, {
          subject,
          steps: visibleTo(step, outputs),
        });
        const result = await runStep(step, request);
        return { step, result };
      }),
    );

    for (const { step, result } of executed) {
      const status: PublicStepStatus =
        result.outcome === 'OK' && result.servedFromCache === true ? 'CACHED' : result.outcome;

      results.set(step.stepKey, {
        stepKey: step.stepKey,
        status,
        provider: result.providerUsed ?? step.provider,
        endpoint: step.endpoint,
        authority: result.authority,
        data: result.data,
        latencyMs: result.latencyMs,
        errorCode: result.errorCode,
        servedFromCache: result.servedFromCache ?? false,
        // NOT_FOUND is an answer and is billed at negative_pct. ERROR never is.
        billable: result.outcome !== 'ERROR',
        providerCost: result.providerCost,
        stepWeight: step.stepWeight,
        required: step.required,
      });
      outputs[step.stepKey] = result.data;

      if (result.outcome === 'ERROR') {
        if (product.partialPolicy === 'ALL_OR_NOTHING' && step.required) {
          return finish(product, results, plan, step, startedAt);
        }
        for (const dependant of collectDependants(plan.dependants, step.stepKey)) {
          if (!results.has(dependant)) {
            skipped.set(dependant, `depends_on:${step.stepKey}`);
          }
        }
      }
    }
  }

  return {
    status: aggregate([...results.values()], product),
    steps: orderedSteps(product, results),
    latencyMs: Date.now() - startedAt,
  };
}

/**
 * A step sees only the steps it declared a dependency on. Reading another step's output
 * without declaring it would work by accident today and break the moment the two land in
 * the same wave.
 */
function visibleTo(
  step: ProductStepDefinition,
  outputs: Readonly<Record<string, Readonly<Record<string, unknown>> | null>>,
): Record<string, Readonly<Record<string, unknown>> | null> {
  const visible: Record<string, Readonly<Record<string, unknown>> | null> = {};
  for (const dependency of step.dependsOn) {
    visible[dependency] = outputs[dependency] ?? null;
  }
  return visible;
}

function skippedOutcome(step: ProductStepDefinition, reason: string): StepOutcome {
  return {
    stepKey: step.stepKey,
    status: 'SKIPPED',
    provider: step.provider,
    endpoint: step.endpoint,
    authority: null,
    data: null,
    latencyMs: 0,
    skippedBecause: reason,
    servedFromCache: false,
    // Guard 04. A step that never ran is never billed.
    billable: false,
    stepWeight: step.stepWeight,
    required: step.required,
  };
}

function finish(
  product: ProductDefinition,
  results: Map<string, StepOutcome>,
  plan: ReturnType<typeof planExecution>,
  failedStep: ProductStepDefinition,
  startedAt: number,
): ExecutionOutcome {
  // ALL_OR_NOTHING: a required step failed, so nothing else runs and nothing else bills.
  for (const step of product.steps) {
    if (!results.has(step.stepKey)) {
      results.set(step.stepKey, skippedOutcome(step, `depends_on:${failedStep.stepKey}`));
    }
  }
  void plan;
  return {
    status: 'ERROR',
    steps: orderedSteps(product, results),
    latencyMs: Date.now() - startedAt,
  };
}

function orderedSteps(
  product: ProductDefinition,
  results: Map<string, StepOutcome>,
): StepOutcome[] {
  return product.steps
    .map((step) => results.get(step.stepKey))
    .filter((outcome): outcome is StepOutcome => outcome !== undefined);
}

/** Step 5 of the execution sequence. */
function aggregate(steps: readonly StepOutcome[], product: ProductDefinition): RunStatus {
  const ran = steps.filter((step) => step.status !== 'SKIPPED');
  const succeeded = ran.filter((step) => step.status === 'OK' || step.status === 'CACHED');
  const notFound = ran.filter((step) => step.status === 'NOT_FOUND');
  const failed = ran.filter((step) => step.status === 'ERROR');

  if (ran.length === 0 || failed.length === ran.length) {
    return 'ERROR';
  }
  if (succeeded.length === 0 && notFound.length > 0 && failed.length === 0) {
    // Every call worked and nothing was found. That is an answer, not a failure.
    return 'NOT_FOUND';
  }
  if (succeeded.length === steps.length) {
    return 'OK';
  }

  // BEST_EFFORT is the default: return what worked rather than failing the request.
  void product;
  return 'PARTIAL';
}
