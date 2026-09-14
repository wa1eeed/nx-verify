import {
  DerivedTenantKeyProvider,
  masterKeySourceFromEnv,
  type TenantKeyProvider,
} from '@nx-verify/core';

/**
 * The tenant key provider, built on first use rather than at import.
 *
 * A build must not need a secret. Constructing this at module scope made `next build`
 * fail on a machine that had no key, which is exactly the machine that should be able to
 * build. Secrets belong to a running request, not to compilation.
 *
 * The source is the deployment's choice, the same one the API and the worker make: a key
 * service where one is configured, and the environment only outside production. The
 * console reveals identifiers, so it must not be the one process still holding a root key
 * in a variable.
 */
let provider: TenantKeyProvider | undefined;

export function getKeys(): TenantKeyProvider {
  if (!provider) {
    provider = new DerivedTenantKeyProvider(masterKeySourceFromEnv());
  }
  return provider;
}
