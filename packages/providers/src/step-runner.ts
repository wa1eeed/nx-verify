import { describeProviderInput } from '@nx-verify/core';
import type { ProviderRegistry } from './registry.js';
import type { ResolvedCredential } from './types.js';

/**
 * Adapts a registered provider into the callback the orchestrator expects.
 *
 * This adapter lives in the providers package on purpose. packages/core must not import
 * packages/providers, or the domain layer would depend on provider code and ADR-006
 * would be dead on arrival. The orchestrator takes a function; this builds one.
 *
 * The fallback provider is handled here rather than in the orchestrator, because which
 * provider answers is a provider concern and the domain must not learn either name.
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
  /** Resolves the credential for a provider, from the tenant's binding. */
  credentialFor: (provider: string) => Promise<ResolvedCredential>;
  idempotencyKey?: string | undefined;
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
   * queries and the rest await that same promise. It also means one binding lookup per
   * provider per run instead of one per step.
   */
  const credentials = new Map<string, Promise<ResolvedCredential>>();

  const credentialFor = (provider: string): Promise<ResolvedCredential> => {
    const inFlight = credentials.get(provider);
    if (inFlight) {
      return inFlight;
    }
    const pending = options.credentialFor(provider);
    credentials.set(provider, pending);
    return pending;
  };

  return async function runStep(
    step: StepDescriptor,
    request: Readonly<Record<string, unknown>>,
  ): Promise<StepRunResult> {
    const attempt = async (providerName: string): Promise<StepRunResult> => {
      const provider = options.registry.get(providerName);
      const credential = await credentialFor(providerName);

      options.onCall?.({
        step: step.stepKey,
        endpoint: step.endpoint,
        credentialRef: credential.ref,
        // Shape only. The keys of this payload are named by the provider, so no denylist
        // could keep an identifier out of it.
        input: describeProviderInput(request),
      });

      const result = await provider.execute({
        endpoint: step.endpoint,
        input: request,
        credential,
        idempotencyKey: options.idempotencyKey,
      });

      return {
        outcome: result.outcome,
        authority: result.authority,
        data: result.data,
        latencyMs: result.latencyMs,
        errorCode: result.errorCode,
        providerCost: result.providerCost,
        providerUsed: providerName,
      };
    };

    const primary = await attempt(step.provider);
    if (primary.outcome !== 'ERROR' || !step.fallbackProvider) {
      return primary;
    }
    if (!options.registry.has(step.fallbackProvider)) {
      return primary;
    }

    // A second provider is what answers the question every financial customer asks:
    // what happens when your provider goes down.
    const fallback = await attempt(step.fallbackProvider);
    return fallback.outcome === 'ERROR' ? primary : fallback;
  };
}
