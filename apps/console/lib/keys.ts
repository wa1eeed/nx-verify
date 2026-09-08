import {
  DerivedTenantKeyProvider,
  EnvMasterKeySource,
  type TenantKeyProvider,
} from '@nx-verify/core';

/**
 * The tenant key provider, built on first use rather than at import.
 *
 * A build must not need a secret. Constructing this at module scope made `next build`
 * fail on a machine that had no key, which is exactly the machine that should be able to
 * build. Secrets belong to a running request, not to compilation.
 */
let provider: TenantKeyProvider | undefined;

export function getKeys(): TenantKeyProvider {
  if (!provider) {
    provider = new DerivedTenantKeyProvider(new EnvMasterKeySource());
  }
  return provider;
}
