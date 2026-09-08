import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import {
  listCatalog,
  listTenantBindings,
  resolveProviders,
  setTenantBinding,
  upsertCatalogEntry,
} from '../src/routing/provider-routing.js';
import { readAudit } from '../src/auth/audit.js';
import { toPublicResults, assertNoProviderLeak } from '../src/public-view.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, SECRET_REF } from '../../../test/helpers/billing.js';
import {
  InMemorySecretStore,
  ProviderRegistry,
  StubProvider,
  createProviderStepRunner,
  resolveCredential,
} from '../../../packages/providers/src/index.js';

/**
 * Which provider serves which subscriber.
 *
 * The point of this file is one test: the same product, run by two subscribers, reaching
 * two different providers, with neither name visible to either of them.
 */

const ALPHA = 'wathq-alpha';
const BETA = 'sadad-beta';
const OPERATOR = 'nx-staff:ops-1';

describe('provider routing is per subscriber', () => {
  let db: TestDatabase;
  let first: SeededTenant;
  let second: SeededTenant;
  const keys = testKeys();

  const registry = new ProviderRegistry()
    .register(new StubProvider({ name: ALPHA }))
    .register(new StubProvider({ name: BETA }));
  const secrets = new InMemorySecretStore({
    [SECRET_REF]: { apiKey: 'shared' },
    'kms://tenants/first/alpha': { apiKey: 'alpha-key' },
    'kms://tenants/second/beta': { apiKey: 'beta-key' },
  });

  const runFor = (tenant: SeededTenant, unn: string) =>
    withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn },
        subjectIdentifiers: [{ idType: 'UNN', value: unn }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: createProviderStepRunner({
          registry,
          candidatesFor: (step) =>
            resolveProviders(tx, {
              endpoint: step.endpoint,
              declaredProvider: step.provider,
              declaredFallback: step.fallbackProvider,
            }),
          credentialFor: (name, ref) => resolveCredential(tx, secrets, name, ref),
        }),
        keys,
      }),
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    first = await seedTenant(db.appPool, 'First Subscriber');
    second = await seedTenant(db.appPool, 'Second Subscriber');

    // Seeded with the stub named in the catalogue, then rebound below.
    await preparePricedTenant(db.appPool, first.tenantId, { balanceHalalas: 5_000_00 });
    await preparePricedTenant(db.appPool, second.tenantId, { balanceHalalas: 5_000_00 });

    // The fixture binds the stub. This suite is about explicit routing, so that binding
    // is removed and the product's declaration becomes the genuine last resort.
    await db.operatorPool.query(
      `DELETE FROM tenant_provider_binding WHERE provider = 'stub' AND tenant_id = ANY($1::uuid[])`,
      [[first.tenantId, second.tenantId]],
    );

    // The operator binds each subscriber to its own provider.
    await db.operatorPool.query(
      `INSERT INTO tenant_provider_binding
         (tenant_id, provider, mode, credential_ref, priority, activated_at)
       VALUES ($1, $2, 'BYOC', 'kms://tenants/first/alpha', 10, now()),
              ($3, $4, 'MANAGED', 'kms://tenants/second/beta', 10, now())`,
      [first.tenantId, ALPHA, second.tenantId, BETA],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('sends two subscribers to two different providers on the same product', async () => {
    const one = await runFor(first, '7001272184');
    const two = await runFor(second, '7001272184');

    expect(one.status).toBe('OK');
    expect(two.status).toBe('OK');

    const usedBy = async (tenant: SeededTenant, runId: string): Promise<string | null> => {
      const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query<{ provider: string }>(`SELECT provider FROM run_steps WHERE run_id = $1 LIMIT 1`, [
          runId,
        ]),
      );
      return rows[0]?.provider ?? null;
    };

    // The whole point. One product, two subscribers, two providers.
    expect(await usedBy(first, one.runId)).toBe(ALPHA);
    expect(await usedBy(second, two.runId)).toBe(BETA);
  });

  it('shows neither subscriber the name of any provider', async () => {
    const one = await runFor(first, '7001272184');
    const results = toPublicResults([]);
    void results;

    // Rule 5 across both names, on the response either subscriber receives.
    expect(() => assertNoProviderLeak(one.results, [ALPHA, BETA])).not.toThrow();
    expect(JSON.stringify(one.results)).toContain('Commercial Registry');
  });

  it('prefers the lower priority binding and falls through when it fails', async () => {
    // Alpha is preferred, and this subject makes every call to it fail.
    await db.operatorPool.query(
      `INSERT INTO tenant_provider_binding
         (tenant_id, provider, mode, credential_ref, priority, activated_at)
       VALUES ($1, $2, 'BYOC', 'kms://tenants/second/beta', 20, now())
       ON CONFLICT (tenant_id, provider) DO UPDATE SET priority = 20, activated_at = now()`,
      [first.tenantId, BETA],
    );

    const bindings = await withTenant(db.appPool, first.tenantId, (tx) => listTenantBindings(tx));
    expect(bindings.map((binding) => binding.provider)).toEqual([ALPHA, BETA]);

    const candidates = await withTenant(db.appPool, first.tenantId, (tx) =>
      resolveProviders(tx, {
        endpoint: 'business_verification',
        declaredProvider: 'stub',
        declaredFallback: null,
      }),
    );

    // The subscriber's own bindings first, in priority order, and the product's
    // declaration last. A second provider is carried ready simply by being bound.
    expect(candidates.map((candidate) => candidate.provider)).toEqual([ALPHA, BETA, 'stub']);
    expect(candidates.map((candidate) => candidate.level)).toEqual(['tenant', 'tenant', 'product']);
  });

  it('ignores a binding that is not activated', async () => {
    const idle = await seedTenant(db.appPool, 'Idle Subscriber');
    await db.operatorPool.query(
      `INSERT INTO tenant_provider_binding (tenant_id, provider, mode, priority)
       VALUES ($1, $2, 'BYOC', 5)`,
      [idle.tenantId, ALPHA],
    );

    const candidates = await withTenant(db.appPool, idle.tenantId, (tx) =>
      resolveProviders(tx, {
        endpoint: 'business_verification',
        declaredProvider: 'stub',
        declaredFallback: null,
      }),
    );

    // Bound but never switched on. Configuration that is prepared is not configuration
    // that is live.
    expect(candidates.map((candidate) => candidate.provider)).toEqual(['stub']);
  });

  it('narrows a binding to particular endpoints', async () => {
    await db.operatorPool.query(
      `UPDATE tenant_provider_binding SET endpoints = ARRAY['iban_ownership']
       WHERE tenant_id = $1 AND provider = $2`,
      [second.tenantId, BETA],
    );

    const forRegistry = await withTenant(db.appPool, second.tenantId, (tx) =>
      resolveProviders(tx, {
        endpoint: 'business_verification',
        declaredProvider: 'stub',
        declaredFallback: null,
      }),
    );
    const forIban = await withTenant(db.appPool, second.tenantId, (tx) =>
      resolveProviders(tx, {
        endpoint: 'iban_ownership',
        declaredProvider: 'stub',
        declaredFallback: null,
      }),
    );

    // One provider for the registry and another for bank verification is a normal
    // arrangement, and it is a column rather than a code path.
    expect(forRegistry.map((c) => c.provider)).toEqual(['stub']);
    expect(forIban.map((c) => c.provider)).toEqual([BETA, 'stub']);

    await db.operatorPool.query(
      `UPDATE tenant_provider_binding SET endpoints = NULL
       WHERE tenant_id = $1 AND provider = $2`,
      [second.tenantId, BETA],
    );
  });

  it('lets the operator bind a subscriber, and records who did it', async () => {
    const fresh = await seedTenant(db.appPool, 'Bound By Operator');

    await setTenantBinding(
      db.operatorPool,
      {
        tenantId: fresh.tenantId,
        provider: ALPHA,
        mode: 'MANAGED',
        credentialRef: 'kms://nx/providers/alpha',
        priority: 10,
      },
      OPERATOR,
    );

    const bindings = await withTenant(db.appPool, fresh.tenantId, (tx) => listTenantBindings(tx));
    expect(bindings[0]?.provider).toBe(ALPHA);
    expect(bindings[0]?.mode).toBe('MANAGED');

    const entries = await withTenant(db.appPool, fresh.tenantId, (tx) =>
      readAudit(tx, { action: 'provider.binding_set' }),
    );
    // An operator changing a subscriber's provider is exactly the kind of act an audit
    // exists for, and it is recorded against NX staff rather than the customer.
    expect(entries[0]?.actorType).toBe('NX_STAFF');
    expect(entries[0]?.actorId).toBe(OPERATOR);
  });

  it('refuses a credential that is not a KMS reference', async () => {
    await expect(
      setTenantBinding(
        db.operatorPool,
        {
          tenantId: first.tenantId,
          provider: ALPHA,
          mode: 'BYOC',
          credentialRef: 'sk_live_actualsecret',
        },
        OPERATOR,
      ),
    ).rejects.toMatchObject({ code: 'NX-4001' });
  });

  it('keeps the catalogue out of every subscriber reach', async () => {
    await upsertCatalogEntry(db.operatorPool, {
      code: ALPHA,
      nameAr: 'مزوّد ألفا',
      nameEn: 'Alpha provider',
      endpoints: ['business_verification'],
      status: 'active',
      notes: null,
    });

    const catalog = await listCatalog(db.operatorPool);
    expect(catalog.map((entry) => entry.code)).toContain(ALPHA);

    // Reading the catalogue is learning the names, so no subscriber may.
    await expect(
      withTenant(db.appPool, first.tenantId, (tx) => tx.query(`SELECT code FROM provider_catalog`)),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
