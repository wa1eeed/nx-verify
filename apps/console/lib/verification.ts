import { isSandbox, resolveProviders, type RunChecksDependencies } from '@nx-verify/core';
import type { TenantTransaction } from '@nx-verify/db';
import {
  createProviderStepRunner,
  registryFor,
  resolveCredential,
  secretStoreFromEnv,
  type ProviderRegistry,
} from '@nx-verify/providers';
import { getKeys } from './keys';
import { query } from './context';

/**
 * What a verification started from the console runs through.
 *
 * The same path the API takes: the connection the administration panel set for the
 * workspace's world, the platform credential behind it, the routing chain, the domain's
 * verify. A check pressed on a screen and a check sent by an integration are the same
 * check, billed and recorded the same way.
 *
 * Which world is read from the workspace, never from the form: a sandbox workspace reaches
 * the sandbox connection and nothing else.
 */

const registries = new Map<'sandbox' | 'live', { registry: ProviderRegistry; expiresAt: number }>();

async function registryForWorkspace(tx: TenantTransaction): Promise<ProviderRegistry> {
  const environment = (await isSandbox(tx)) ? 'sandbox' : 'live';
  const cached = registries.get(environment);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.registry;
  }
  const registry = await registryFor(tx, environment);
  // Held for a minute, like the API: long enough not to rebuild per click, short enough
  // that a connection saved in the panel is in use before anybody wonders why it is not.
  registries.set(environment, { registry, expiresAt: Date.now() + 60_000 });
  return registry;
}

export async function checkDependencies(): Promise<RunChecksDependencies> {
  const secrets = secretStoreFromEnv();
  const registry = await query((tx) => registryForWorkspace(tx));

  return {
    inTenant: (work) => query(work),
    keys: getKeys(),
    runStepFor: (tx) =>
      createProviderStepRunner({
        registry,
        candidatesFor: (step) =>
          resolveProviders(tx, {
            endpoint: step.endpoint,
            declaredProvider: step.provider,
            declaredFallback: step.fallbackProvider,
          }),
        credentialFor: (name, ref) => resolveCredential(tx, secrets, name, ref),
      }),
  };
}
