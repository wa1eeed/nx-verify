import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../../../packages/core/src/verification/verify.js';
import { getEntityProfile } from '../../../packages/core/src/repositories/profile.js';
import { getRelations } from '../../../packages/core/src/normalisation/network.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, SECRET_REF } from '../../../test/helpers/billing.js';
import { ProviderRegistry } from '../src/registry.js';
import { StubProvider } from '../src/stub/stub-provider.js';
import { HttpVerificationProvider } from '../src/http/http-provider.js';
import { InMemorySecretStore, resolveCredential } from '../src/credentials.js';
import { createProviderStepRunner } from '../src/step-runner.js';
import { recordedFetch } from './fixtures/recorded.js';

/**
 * Unit 9, which docs/00-START-HERE.md defines as a test of the architecture rather than a
 * feature: if connecting a real provider needs a change outside packages/providers, the
 * abstraction failed and must be fixed before anything else proceeds.
 *
 * Two proofs. The same product, run through the stub and then through a real HTTP
 * adapter, produces identical attestations, entities and relations. And no file outside
 * this package names the adapter, except the one line of wiring that chooses it.
 */

const PROVIDER_NAME = 'wathq-example-connector';
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('a real provider changes nothing in the domain', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();
  const secrets = new InMemorySecretStore({ [SECRET_REF]: { apiKey: 'recorded-key' } });

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Boundary Tenant');
    await preparePricedTenant(db, tenant.tenantId, { providerName: PROVIDER_NAME });
  });

  afterAll(async () => {
    await db.close();
  });

  const runWith = async (registry: ProviderRegistry, unn: string) => {
    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'KYB_COMPLETE',
        subject: { unn, manager: { id: '1098765432', id_type: 'NATIONAL_ID' } },
        subjectIdentifiers: [{ idType: 'UNN', value: unn }],
        triggeredBy: 'API',
        modeAtExecution: 'MANAGED',
        runStep: createProviderStepRunner({
          registry,
          credentialFor: (name) => resolveCredential(tx, secrets, name),
        }),
        keys,
      }),
    );

    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, result.entityId ?? ''),
    );
    const relations = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getRelations(tx, result.entityId ?? ''),
    );

    return {
      status: result.status,
      results: result.results,
      billing: result.billing,
      fields: profile
        .map((field) => `${field.fieldPath}=${JSON.stringify(field.value)}@${field.authority}`)
        .sort(),
      relationTypes: relations.map((edge) => edge.relType).sort(),
    };
  };

  it('produces the same facts through the stub and through a real http adapter', async () => {
    const stubRegistry = new ProviderRegistry().register(new StubProvider({ name: PROVIDER_NAME }));

    const { fetch } = recordedFetch();
    const httpRegistry = new ProviderRegistry().register(
      new HttpVerificationProvider({
        name: PROVIDER_NAME,
        baseUrl: 'https://upstream.example',
        fetch,
        retryDelayMs: 1,
      }),
    );

    // Two different subjects so each gets its own entity, and the same identifier would
    // otherwise resolve both runs onto one.
    const viaStub = await runWith(stubRegistry, '7001272184');
    const viaHttp = await runWith(httpRegistry, '7001272184');

    expect(viaHttp.status).toBe(viaStub.status);
    expect(viaHttp.relationTypes).toEqual(viaStub.relationTypes);
    expect(viaHttp.billing).toEqual(viaStub.billing);

    // The attestations are the product. If these match, nothing in the domain noticed
    // that the provider changed.
    expect(viaHttp.fields).toEqual(viaStub.fields);
    expect(Object.keys(viaHttp.results)).toEqual(Object.keys(viaStub.results));
  });

  it('leaves the provider name out of the public results either way', async () => {
    const { fetch } = recordedFetch();
    const registry = new ProviderRegistry().register(
      new HttpVerificationProvider({
        name: PROVIDER_NAME,
        baseUrl: 'https://upstream.example',
        fetch,
        retryDelayMs: 1,
      }),
    );

    const outcome = await runWith(registry, '7001272184');
    expect(JSON.stringify(outcome.results)).not.toContain(PROVIDER_NAME);
    expect(JSON.stringify(outcome.results)).toContain('Commercial Registry');
  });
});

describe('the adapter stays inside its package', () => {
  const sourceFiles = (): string[] => {
    const files: string[] = [];
    const skip = new Set(['node_modules', '.git', '.next', 'dist', '.turbo', 'coverage']);

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (skip.has(entry)) {
          continue;
        }
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          files.push(full);
        }
      }
    };

    walk(join(REPO_ROOT, 'apps'));
    walk(join(REPO_ROOT, 'packages'));
    walk(join(REPO_ROOT, 'test'));
    return files;
  };

  it('is named only inside packages/providers, or in a line that wires it up', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const relativePath = relative(REPO_ROOT, file);
      if (relativePath.startsWith('packages/providers/')) {
        continue;
      }
      if (readFileSync(file, 'utf8').includes('HttpVerificationProvider')) {
        offenders.push(relativePath);
      }
    }

    // Everything that knows a real provider exists lives in one package. Choosing which
    // provider to register is the only thing an application decides.
    expect(offenders).toEqual([]);
  });

  it('keeps the domain package free of any provider import', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const relativePath = relative(REPO_ROOT, file);
      if (!relativePath.startsWith('packages/core/src/')) {
        continue;
      }
      const source = readFileSync(file, 'utf8');
      if (source.includes('@nx-verify/providers') || source.includes('providers/src')) {
        offenders.push(relativePath);
      }
    }

    // ADR-006 and ADR-016. The orchestrator takes a function; it does not import a
    // provider, and it cannot name one.
    expect(offenders).toEqual([]);
  });

  it('exposes both providers through one interface, so swapping is a registry line', () => {
    const { fetch } = recordedFetch();
    const registry = new ProviderRegistry()
      .register(new StubProvider({ name: 'sandbox' }))
      .register(
        new HttpVerificationProvider({
          name: 'live',
          baseUrl: 'https://upstream.example',
          fetch,
        }),
      );

    for (const name of ['sandbox', 'live']) {
      const provider = registry.get(name);
      expect(typeof provider.execute).toBe('function');
      expect(typeof provider.healthCheck).toBe('function');
      expect(provider.endpoints).toContain('business_verification');
    }
  });
});
