import {
  hasOpenRequests,
  isSandbox,
  resolveProviders,
  resumeRequests,
  type ResumeRequestsOptions,
  type TenantKeyProvider,
} from '@nx-verify/core';
import type { TenantTransaction } from '@nx-verify/db';
import {
  createProviderStepRunner,
  resolveCredential,
  type ProviderRegistry,
  type SecretStore,
} from '@nx-verify/providers';

/**
 * Verification requests nobody is running (handoff screen 02).
 *
 * The console runs a request in the background the moment it is pressed. A restart, a
 * dropped connection or a check waiting to be tried again leaves some behind, and this sweep
 * finishes them. It reaches the authority the way the console does: through the connection
 * the administration panel set for the workspace's world, so a sandbox workspace is answered
 * by the sandbox and nothing else (guard 09).
 */

export interface RequestSweepOptions extends ResumeRequestsOptions {
  keys: TenantKeyProvider;
  secrets: SecretStore;
  registryFor: (environment: 'sandbox' | 'live') => Promise<ProviderRegistry>;
  /**
   * A transaction of its own for this workspace. Each check commits on its own, so a balance
   * that runs out on the fourth leaves the first three recorded.
   */
  inTenant: <T>(work: (tx: TenantTransaction) => Promise<T>) => Promise<T>;
}

export async function runVerificationRequests(
  tx: TenantTransaction,
  { keys, secrets, registryFor, inTenant, ...options }: RequestSweepOptions,
): Promise<number> {
  if (!(await hasOpenRequests(tx))) {
    return 0;
  }
  const registry = await registryFor((await isSandbox(tx)) ? 'sandbox' : 'live');

  return resumeRequests(
    {
      inTenant,
      keys,
      runStepFor: (inner) =>
        createProviderStepRunner({
          registry,
          candidatesFor: (step) =>
            resolveProviders(inner, {
              endpoint: step.endpoint,
              declaredProvider: step.provider,
              declaredFallback: step.fallbackProvider,
            }),
          credentialFor: (name, ref) => resolveCredential(inner, secrets, name, ref),
        }),
    },
    options,
  );
}
