import { describeProviderInput } from '@nx-verify/core';
import type { ProviderCandidate } from '@nx-verify/core';
import type { ProviderRegistry } from './registry.js';
import type { ResolvedCredential } from './types.js';

/**
 * Adapts a registered provider into the callback the orchestrator expects.
 *
 * This adapter lives in the providers package on purpose. packages/core must not import
 * packages/providers, or the domain layer would depend on provider code and ADR-006
 * would be dead on arrival. The orchestrator takes a function; this builds one.
 *
 * Which provider answers is decided here rather than in the orchestrator, because that is
 * a provider concern and the domain must not learn any of the names.
 *
 * With several providers bound to a subscriber, the candidate list comes from the routing
 * resolver: the tenant's bindings in priority order, then whatever the product declared
 * (ADR-043). This walks it and stops at the first provider that gives an answer. A
 * candidate this deployment does not run, or that does not serve the endpoint, is skipped
 * rather than treated as a failure, because that is a configuration left over from
 * somewhere else and not a failure of this call.
 */

export interface StepDescriptor {
  stepKey: string;
  provider: string;
  endpoint: string;
  fallbackProvider: string | null;
}

export interface StepRunResult {
  outcome: 'OK' | 'NOT_FOUND' | 'ERROR';
  authority: string | null;
  data: Readonly<Record<string, unknown>> | null;
  latencyMs: number;
  errorCode?: string | undefined;
  providerCost?: number | undefined;
  servedFromCache?: boolean | undefined;
  providerUsed?: string | undefined;
}

export interface StepRunnerOptions {
  registry: ProviderRegistry;
  /**
   * Ordered candidates for a step, most preferred first. When absent the step's own
   * declaration is used, which is how a single provider deployment keeps working.
   */
  candidatesFor?: ((step: StepDescriptor) => Promise<ProviderCandidate[]>) | undefined;
  /** Resolves the credential for a provider, from the binding that named it. */
  credentialFor: (provider: string, credentialRef?: string | null) => Promise<ResolvedCredential>;
  idempotencyKey?: string | undefined;
  /** Forces a named answer from the stub. Ignored by a real provider, and by design. */
  testScenario?: string | undefined;
  /** Receives shape only log records. Values never reach it. */
  onCall?: ((record: Record<string, unknown>) => void) | undefined;
}

export function createProviderStepRunner(options: StepRunnerOptions) {
  /**
   * Credential lookups are memoised by their in-flight promise, not by their result.
   *
   * Steps in the same wave run together, and a pg client cannot serve two queries at
   * once. Caching the resolved value would not help, because concurrent callers all miss
   * an empty cache and all issue a query. Caching the promise means the first caller
   * queries and the rest await that same promise.
   */
  const credentials = new Map<string, Promise<ResolvedCredential>>();

  const credentialFor = (
    provider: string,
    ref: string | null | undefined,
  ): Promise<ResolvedCredential> => {
    const key = `${provider}:${ref ?? ''}`;
    const inFlight = credentials.get(key);
    if (inFlight) {
      return inFlight;
    }
    const pending = options.credentialFor(provider, ref);
    credentials.set(key, pending);
    return pending;
  };

  /**
   * Nothing is held between calls except that cache. Steps in one wave run concurrently,
   * so the step and the request travel as arguments rather than as shared state.
   */
  const attempt = async (
    candidate: ProviderCandidate,
    step: StepDescriptor,
    request: Readonly<Record<string, unknown>>,
  ): Promise<StepRunResult> => {
    const provider = options.registry.get(candidate.provider);
    const credential = await credentialFor(candidate.provider, candidate.credentialRef);

    options.onCall?.({
      step: step.stepKey,
      endpoint: step.endpoint,
      credentialRef: credential.ref,
      // Which level of the chain chose this provider, for the operator's own diagnosis.
      level: candidate.level,
      // Shape only. The keys of this payload are named by the provider, so no denylist
      // could keep an identifier out of it.
      input: describeProviderInput(request),
    });

    const result = await provider.execute({
      endpoint: step.endpoint,
      input: request,
      credential,
      idempotencyKey: options.idempotencyKey,
      testScenario: options.testScenario,
    });

    return {
      outcome: result.outcome,
      authority: result.authority,
      data: result.data,
      latencyMs: result.latencyMs,
      errorCode: result.errorCode,
      providerCost: result.providerCost,
      providerUsed: candidate.provider,
    };
  };

  return async function runStep(
    step: StepDescriptor,
    request: Readonly<Record<string, unknown>>,
  ): Promise<StepRunResult> {
    const candidates = options.candidatesFor
      ? await options.candidatesFor(step)
      : declaredOnly(step);

    const runnable = candidates.filter(
      (candidate) =>
        options.registry.has(candidate.provider) &&
        options.registry.get(candidate.provider).endpoints.includes(step.endpoint),
    );

    if (runnable.length === 0) {
      return {
        outcome: 'ERROR',
        authority: null,
        data: null,
        latencyMs: 0,
        errorCode: 'UNSUPPORTED_ENDPOINT',
      };
    }

    let firstFailure: StepRunResult | null = null;

    for (const candidate of runnable) {
      const result = await attempt(candidate, step, request);
      if (result.outcome !== 'ERROR') {
        return result;
      }
      // If every candidate fails, the run reports the first failure, because it came from
      // the provider the operator meant to use.
      firstFailure ??= result;
    }

    return (
      firstFailure ?? {
        outcome: 'ERROR',
        authority: null,
        data: null,
        latencyMs: 0,
        errorCode: 'UPSTREAM',
      }
    );
  };
}

/** Used when no routing resolver is supplied, which keeps a single provider deployment working. */
function declaredOnly(step: StepDescriptor): ProviderCandidate[] {
  const candidates: ProviderCandidate[] = [
    { provider: step.provider, mode: 'BYOC', credentialRef: null, level: 'product' },
  ];
  if (step.fallbackProvider) {
    candidates.push({
      provider: step.fallbackProvider,
      mode: 'BYOC',
      credentialRef: null,
      level: 'product',
    });
  }
  return candidates;
}
