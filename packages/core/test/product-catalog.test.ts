import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { applyProductSeed, type SeedProduct } from '../../../packages/db/src/seed/products.js';
import {
  InMemorySecretStore,
  ProviderRegistry,
  StubProvider,
  createProviderStepRunner,
  resolveCredential,
} from '../../../packages/providers/src/index.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { listProducts, requireProduct } from '../src/products/catalog.js';
import { executeProduct } from '../src/orchestration/executor.js';
import { getRun, recordRun } from '../src/orchestration/run-recorder.js';
import { assertNoProviderLeak, toPublicResults } from '../src/public-view.js';
import { invalidateSchemaCache } from '../src/products/input-validation.js';

/**
 * Unit 4 acceptance, and the measurement point docs/README.md sets: add a new
 * verification product with database rows only, no deployment and no code.
 */

const SECRET_REF = 'kms://tenants/test/providers/stub';

describe('the product catalog drives execution', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const registry = new ProviderRegistry().register(new StubProvider());
  const secrets = new InMemorySecretStore({ [SECRET_REF]: { apiKey: 'test-key' } });

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Catalog Tenant');
    invalidateSchemaCache();

    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx));
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(
        `INSERT INTO tenant_provider_binding (tenant_id, provider, mode, credential_ref, activated_at)
         VALUES ($1, 'stub', 'BYOC', $2, now())`,
        [tenant.tenantId, SECRET_REF],
      ),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  const runProduct = async (code: string, subject: Record<string, unknown>) =>
    withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const product = await requireProduct(tx, code);
      const runStep = createProviderStepRunner({
        registry,
        credentialFor: (provider) => resolveCredential(tx, secrets, provider),
      });
      const outcome = await executeProduct({ product, subject, runStep });
      const recorded = await recordRun(tx, {
        productCode: product.code,
        entityId: tenant.entityId,
        modeAtExecution: 'BYOC',
        status: outcome.status,
        latencyMs: outcome.latencyMs,
        triggeredBy: 'API',
        steps: outcome.steps,
      });
      return { outcome, recorded };
    });

  it('exposes the catalog so a customer can generate their own form', async () => {
    const products = await withTenant(db.appPool, tenant.tenantId, (tx) => listProducts(tx));
    expect(products.map((product) => product.code).sort()).toEqual([
      'ADDRESS_ONLY',
      'AOA_ONLY',
      'BANK_ACCOUNT_OWNERSHIP',
      'FREELANCER_CERTIFICATE',
      'IBAN_OWNERSHIP',
      'INCOME_VERIFICATION',
      'KYB_COMPLETE',
      'MANAGER_PERMISSIONS',
      'NAME_MATCH',
    ]);
    // The schema travels with the product, which is why adding one needs no change on
    // the customer's side either.
    expect(products.find((p) => p.code === 'ADDRESS_ONLY')?.inputSchema).toMatchObject({
      required: ['unn'],
    });
  });

  it('runs a single step product', async () => {
    const { outcome } = await runProduct('ADDRESS_ONLY', { unn: '7001272184' });
    expect(outcome.status).toBe('OK');
    expect(outcome.steps).toHaveLength(1);
    expect(outcome.steps[0]?.authority).toBe('Commercial Registry');
  });

  it('runs a composite product and passes output between steps', async () => {
    const { outcome } = await runProduct('KYB_COMPLETE', {
      cr_number: '1010478213',
      manager: { id: '1098765432', id_type: 'NATIONAL_ID' },
    });

    expect(outcome.status).toBe('OK');
    expect(outcome.steps.map((step) => step.stepKey)).toEqual([
      'cr_full',
      'address',
      'aoa',
      'manager_auth',
      'ubo',
    ]);
    // manager_auth could only have been called with the number cr_full returned.
    expect(outcome.steps.find((step) => step.stepKey === 'manager_auth')?.data).toMatchObject({
      unified_number: '7001272184',
    });
  });

  it('records the run and its steps, and reads them back', async () => {
    const { recorded } = await runProduct('KYB_COMPLETE', { unn: '7001272184' });
    const stored = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getRun(tx, recorded.runId),
    );

    expect(stored?.status).toBe('OK');
    expect(stored?.steps).toHaveLength(5);
    expect(stored?.productCode).toBe('KYB_COMPLETE');
  });

  it('never lets the provider reach the public results', async () => {
    const { outcome } = await runProduct('ADDRESS_ONLY', { unn: '7001272184' });
    const results = toPublicResults(outcome.steps);
    expect(() => assertNoProviderLeak(results, registry.names())).not.toThrow();
  });

  it('handles a subject the authority does not have', async () => {
    const { outcome } = await runProduct('ADDRESS_ONLY', { unn: '7000000000' });
    expect(outcome.status).toBe('NOT_FOUND');
    expect(outcome.steps[0]?.billable).toBe(true);
  });

  it('returns PARTIAL when the payload is incomplete rather than failing', async () => {
    const { outcome } = await runProduct('KYB_COMPLETE', { unn: '7000000003' });
    // The registry answered with a thin payload and has no articles of association for
    // this entity. A sole proprietorship looks exactly like this.
    expect(outcome.status).toBe('PARTIAL');
    expect(outcome.steps.find((step) => step.stepKey === 'ubo')?.status).toBe('NOT_FOUND');
  });

  it('refuses a subject that fails the product schema before calling anything', async () => {
    await expect(runProduct('ADDRESS_ONLY', { unn: 'not-a-number' })).rejects.toMatchObject({
      code: 'NX-4002',
    });
  });

  it('adds an entirely new product with database rows and no code', async () => {
    // The measurement point. This product exists nowhere in the source tree: not in the
    // seed, not in a switch, not in a type. It is four inserts.
    const newProduct: SeedProduct = {
      code: 'FREELANCE_CHECK',
      nameAr: 'التحقق من وثيقة العمل الحر',
      nameEn: 'Freelance document verification',
      subjectType: 'FREELANCER',
      isComposite: true,
      partialPolicy: 'BEST_EFFORT',
      inputSchema: {
        type: 'object',
        required: ['unn'],
        properties: { unn: { type: 'string' }, holder_id: { type: 'string' } },
      },
      steps: [
        {
          stepKey: 'registry',
          seq: 1,
          provider: 'stub',
          endpoint: 'business_verification',
          inputBinding: { identifications: '$.subject.unn' },
          required: true,
          stepWeight: 60,
        },
        {
          stepKey: 'owner',
          seq: 2,
          provider: 'stub',
          endpoint: 'ultimate_beneficial_owner',
          inputBinding: { unified_number: '$.steps.registry.unified_number' },
          dependsOn: ['registry'],
          required: false,
          stepWeight: 40,
        },
      ],
    };

    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx, [newProduct]));

    const { outcome, recorded } = await runProduct('FREELANCE_CHECK', { unn: '7001272184' });

    expect(outcome.status).toBe('OK');
    expect(outcome.steps.map((step) => step.stepKey)).toEqual(['registry', 'owner']);
    expect(recorded.runId).toBeTruthy();

    const catalog = await withTenant(db.appPool, tenant.tenantId, (tx) => listProducts(tx));
    expect(catalog.map((product) => product.code)).toContain('FREELANCE_CHECK');
  });

  it('keeps runs inside the tenant that made them', async () => {
    const { recorded } = await runProduct('ADDRESS_ONLY', { unn: '7001272184' });
    const other = await seedTenant(db.appPool, 'Catalog Other Tenant');
    const stolen = await withTenant(db.appPool, other.tenantId, (tx) => getRun(tx, recorded.runId));
    expect(stolen).toBeNull();
  });
});
