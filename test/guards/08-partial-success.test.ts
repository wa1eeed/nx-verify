import { describe, expect, it } from 'vitest';
import { executeProduct } from '../../packages/core/src/orchestration/executor.js';
import { SEED_PRODUCTS } from '../../packages/db/src/seed/products.js';
import type {
  ProductDefinition,
  ProductStepDefinition,
} from '../../packages/core/src/products/catalog.js';
import type { StepRunner } from '../../packages/core/src/orchestration/executor.js';

/**
 * Guard 08: a failing step that is not required yields PARTIAL, not ERROR.
 *
 * The default partial_policy is BEST_EFFORT: return what worked, mark the dependants
 * SKIPPED, and bill neither the failure nor the skips. A sole proprietorship with no
 * articles of association must get a correct answer with status PARTIAL rather than a
 * failed request, which is a large difference in customer experience and the reason four
 * of the five steps in KYB_COMPLETE are optional.
 *
 * The runner is supplied by the test so that a chosen step fails. Driving this through
 * the provider would test the provider's scenario table, not the orchestrator.
 */

const KYB = SEED_PRODUCTS.find((product) => product.code === 'KYB_COMPLETE');

function productFromSeed(partialPolicy: 'BEST_EFFORT' | 'ALL_OR_NOTHING'): ProductDefinition {
  if (!KYB) {
    throw new Error('KYB_COMPLETE is missing from the seed');
  }
  return {
    code: KYB.code,
    nameAr: KYB.nameAr,
    nameEn: KYB.nameEn,
    subjectType: 'BUSINESS',
    inputSchema: KYB.inputSchema,
    isComposite: true,
    partialPolicy,
    decisionRuleset: null,
    status: 'active',
    steps: KYB.steps.map((step): ProductStepDefinition => ({
      stepKey: step.stepKey,
      seq: step.seq,
      provider: step.provider,
      endpoint: step.endpoint,
      inputBinding: step.inputBinding,
      dependsOn: step.dependsOn ?? [],
      required: step.required ?? true,
      fallbackProvider: null,
      cacheTtlDays: step.cacheTtlDays ?? null,
      stepWeight: step.stepWeight ?? 1,
    })),
  };
}

/** Succeeds for every step except the ones named, which fail with a network error. */
function runnerFailing(...failing: string[]): StepRunner {
  return (step) =>
    Promise.resolve(
      failing.includes(step.stepKey)
        ? {
            outcome: 'ERROR' as const,
            authority: null,
            data: null,
            latencyMs: 5,
            errorCode: 'NETWORK',
          }
        : {
            outcome: 'OK' as const,
            authority: 'Commercial Registry',
            data: { unified_number: '7001272184', ok: true },
            latencyMs: 5,
          },
    );
}

const SUBJECT = { unn: '7001272184', manager: { id: '1098765432', id_type: 'NATIONAL_ID' } };

describe('guard 08: a non required step failure yields PARTIAL', () => {
  it('returns PARTIAL and skips the dependants when an optional step fails', async () => {
    const outcome = await executeProduct({
      product: productFromSeed('BEST_EFFORT'),
      subject: SUBJECT,
      runStep: runnerFailing('aoa'),
    });

    expect(outcome.status).toBe('PARTIAL');

    const byKey = new Map(outcome.steps.map((step) => [step.stepKey, step]));
    expect(byKey.get('cr_full')?.status).toBe('OK');
    expect(byKey.get('address')?.status).toBe('OK');
    expect(byKey.get('ubo')?.status).toBe('OK');
    expect(byKey.get('aoa')?.status).toBe('ERROR');
    expect(byKey.get('manager_auth')?.status).toBe('SKIPPED');
    expect(byKey.get('manager_auth')?.skippedBecause).toBe('depends_on:aoa');
  });

  it('bills neither the failed step nor the skipped one', async () => {
    const outcome = await executeProduct({
      product: productFromSeed('BEST_EFFORT'),
      subject: SUBJECT,
      runStep: runnerFailing('aoa'),
    });

    const byKey = new Map(outcome.steps.map((step) => [step.stepKey, step]));
    // An error means we never got an answer. A skip means the work never happened.
    expect(byKey.get('aoa')?.billable).toBe(false);
    expect(byKey.get('manager_auth')?.billable).toBe(false);
    expect(byKey.get('cr_full')?.billable).toBe(true);
  });

  it('cascades a skip through a chain of dependants', async () => {
    const outcome = await executeProduct({
      product: productFromSeed('BEST_EFFORT'),
      subject: SUBJECT,
      runStep: runnerFailing('cr_full'),
    });

    const byKey = new Map(outcome.steps.map((step) => [step.stepKey, step]));
    // manager_auth depends on aoa, which depends on cr_full. The skip has to reach it.
    for (const key of ['address', 'aoa', 'ubo', 'manager_auth']) {
      expect(byKey.get(key)?.status, key).toBe('SKIPPED');
      expect(byKey.get(key)?.billable, key).toBe(false);
    }
    expect(outcome.status).toBe('ERROR');
  });

  it('fails the whole run when a required step fails under ALL_OR_NOTHING', async () => {
    const outcome = await executeProduct({
      product: productFromSeed('ALL_OR_NOTHING'),
      subject: SUBJECT,
      runStep: runnerFailing('cr_full'),
    });

    expect(outcome.status).toBe('ERROR');
    for (const step of outcome.steps) {
      expect(step.billable, step.stepKey).toBe(false);
    }
  });

  it('separates a subject that is absent from a call that failed', async () => {
    const outcome = await executeProduct({
      product: productFromSeed('BEST_EFFORT'),
      subject: SUBJECT,
      runStep: (step) =>
        Promise.resolve({
          outcome: step.stepKey === 'aoa' ? ('NOT_FOUND' as const) : ('OK' as const),
          authority: 'Commercial Registry',
          data: step.stepKey === 'aoa' ? null : { unified_number: '7001272184' },
          latencyMs: 5,
        }),
    });

    const aoa = outcome.steps.find((step) => step.stepKey === 'aoa');
    expect(aoa?.status).toBe('NOT_FOUND');
    // NOT_FOUND is an answer. It is billed at negative_pct, and its dependants still run.
    expect(aoa?.billable).toBe(true);
    expect(outcome.steps.find((step) => step.stepKey === 'manager_auth')?.status).not.toBe(
      'SKIPPED',
    );
    expect(outcome.status).toBe('PARTIAL');
  });

  it('returns NOT_FOUND when every call worked and nothing was found', async () => {
    const outcome = await executeProduct({
      product: productFromSeed('BEST_EFFORT'),
      subject: SUBJECT,
      runStep: () =>
        Promise.resolve({
          outcome: 'NOT_FOUND' as const,
          authority: 'Commercial Registry',
          data: null,
          latencyMs: 5,
        }),
    });

    expect(outcome.status).toBe('NOT_FOUND');
  });

  it('returns OK only when every step succeeded', async () => {
    const outcome = await executeProduct({
      product: productFromSeed('BEST_EFFORT'),
      subject: SUBJECT,
      runStep: () =>
        Promise.resolve({
          outcome: 'OK' as const,
          authority: 'Commercial Registry',
          data: { unified_number: '7001272184' },
          latencyMs: 5,
        }),
    });

    expect(outcome.status).toBe('OK');
    expect(outcome.steps).toHaveLength(5);
  });

  it('refuses a subject that does not match the product schema, before any call', async () => {
    let called = 0;
    const outcome = executeProduct({
      product: productFromSeed('BEST_EFFORT'),
      subject: { manager: { id: '1098765432' } },
      runStep: () => {
        called += 1;
        return Promise.resolve({
          outcome: 'OK' as const,
          authority: null,
          data: {},
          latencyMs: 1,
        });
      },
    });

    await expect(outcome).rejects.toMatchObject({ code: 'NX-4002' });
    // A malformed request must cost the customer nothing.
    expect(called).toBe(0);
  });
});
