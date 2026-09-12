import { createPool, withTenant, withoutTenant, type TenantTransaction } from '@nx-verify/db';
import {
  DerivedTenantKeyProvider,
  EnvMasterKeySource,
  masterKeySourceFromEnv,
  InMemoryEvidenceStore,
  type EvidenceStore,
  type TenantKeyProvider,
} from '@nx-verify/core';
import {
  secretStoreFromEnv,
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
  /** Where rendered evidence documents are written. */
  evidence: EvidenceStore;
  /** The address the verification link on a document points at. */
  publicBaseUrl: string;
  registry: ProviderRegistry;
  secrets: SecretStore;
  withTenant: <T>(tenantId: string, handler: (tx: TenantTransaction) => Promise<T>) => Promise<T>;
  withoutTenant: <T>(
    handler: (tx: Omit<TenantTransaction, 'tenantId'>) => Promise<T>,
  ) => Promise<T>;
  stepRunnerFor: (
    tx: TenantTransaction,
    options?: { testScenario?: string | undefined },
  ) => ReturnType<typeof createProviderStepRunner>;
}

export interface BuildContextOptions {
  connectionString?: string;
  masterKey?: string;
  secrets?: SecretStore;
  registry?: ProviderRegistry;
  evidence?: EvidenceStore;
  publicBaseUrl?: string;
}

export function buildContext(options: BuildContextOptions = {}): AppContext {
  const connectionString = options.connectionString ?? process.env['NX_APP_DATABASE_URL'] ?? '';
  if (!connectionString) {
    throw new Error('NX_APP_DATABASE_URL is not set');
  }

  const pool = createPool(connectionString);
  // A key given directly is a test's key. Everything else takes the deployment's choice:
  // a key service where one is configured, and the environment only outside production.
  const keys = new DerivedTenantKeyProvider(
    options.masterKey === undefined
      ? masterKeySourceFromEnv()
      : new EnvMasterKeySource({ NX_MASTER_KEY: options.masterKey }),
  );
  const registry = options.registry ?? createProviderRegistry(providerConfigFromEnv());
  // Not an empty in memory store by default. A deployment that never passed one would
  // have started happily and failed at the first provider call with a missing reference,
  // which is a bad way to learn that the secret manager was never wired.
  const secrets = options.secrets ?? secretStoreFromEnv();

  return {
    pool,
    keys,
    registry,
    secrets,
    evidence: options.evidence ?? new InMemoryEvidenceStore(),
    publicBaseUrl: options.publicBaseUrl ?? process.env['NX_PUBLIC_BASE_URL'] ?? 'https://verify.nx.sa',
    withTenant: (tenantId, handler) => withTenant(pool, tenantId, handler),
    withoutTenant: (handler) => withoutTenant(pool, handler),
    stepRunnerFor: (tx, runnerOptions) =>
      createProviderStepRunner({
        registry,
        credentialFor: (provider) => resolveCredential(tx, secrets, provider),
        ...(runnerOptions?.testScenario === undefined
          ? {}
          : { testScenario: runnerOptions.testScenario }),
      }),
  };
}
