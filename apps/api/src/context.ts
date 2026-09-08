import { createPool, withTenant, withoutTenant, type TenantTransaction } from '@nx-verify/db';
import {
  DerivedTenantKeyProvider,
  EnvMasterKeySource,
  type TenantKeyProvider,
} from '@nx-verify/core';
import {
  InMemorySecretStore,
  createProviderRegistry,
  createProviderStepRunner,
  providerConfigFromEnv,
  resolveCredential,
  type ProviderRegistry,
  type SecretStore,
} from '@nx-verify/providers';
import type pg from 'pg';

/**
 * Everything the API needs that is not a request.
 *
 * The registry is built from configuration, never from a named implementation. Going
 * from the stub to a real provider is an environment variable, and nothing in this file
 * or anywhere else in the app changes. That is the test unit 9 sets for the abstraction,
 * and packages/providers/test/abstraction-boundary.test.ts enforces it.
 */

export interface AppContext {
  pool: pg.Pool;
  keys: TenantKeyProvider;
  registry: ProviderRegistry;
  secrets: SecretStore;
  withTenant: <T>(tenantId: string, handler: (tx: TenantTransaction) => Promise<T>) => Promise<T>;
  withoutTenant: <T>(
    handler: (tx: Omit<TenantTransaction, 'tenantId'>) => Promise<T>,
  ) => Promise<T>;
  stepRunnerFor: (tx: TenantTransaction) => ReturnType<typeof createProviderStepRunner>;
}

export interface BuildContextOptions {
  connectionString?: string;
  masterKey?: string;
  secrets?: SecretStore;
  registry?: ProviderRegistry;
}

export function buildContext(options: BuildContextOptions = {}): AppContext {
  const connectionString = options.connectionString ?? process.env['NX_APP_DATABASE_URL'] ?? '';
  if (!connectionString) {
    throw new Error('NX_APP_DATABASE_URL is not set');
  }

  const pool = createPool(connectionString);
  const keys = new DerivedTenantKeyProvider(
    new EnvMasterKeySource(
      options.masterKey === undefined ? process.env : { NX_MASTER_KEY: options.masterKey },
    ),
  );
  const registry = options.registry ?? createProviderRegistry(providerConfigFromEnv());
  const secrets = options.secrets ?? new InMemorySecretStore();

  return {
    pool,
    keys,
    registry,
    secrets,
    withTenant: (tenantId, handler) => withTenant(pool, tenantId, handler),
    withoutTenant: (handler) => withoutTenant(pool, handler),
    stepRunnerFor: (tx) =>
      createProviderStepRunner({
        registry,
        credentialFor: (provider) => resolveCredential(tx, secrets, provider),
      }),
  };
}
