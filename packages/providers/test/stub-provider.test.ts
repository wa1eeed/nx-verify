import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { InMemorySecretStore, resolveCredential, getProviderBinding } from '../src/credentials.js';
import { ProviderRegistry } from '../src/registry.js';
import { StubProvider } from '../src/stub/stub-provider.js';
import type { ResolvedCredential } from '../src/types.js';

/**
 * Unit 3 acceptance: a full verification runs with no real account anywhere.
 *
 * The five scenarios below are the ones that decide whether the platform survives
 * contact with production: a clean success, a subject that does not exist, a call that
 * never arrived, a credential that was rejected, and a success whose payload is missing
 * half its fields.
 */

const CREDENTIAL: ResolvedCredential = {
  ref: 'kms://tenants/test/providers/stub',
  mode: 'BYOC',
  material: { apiKey: 'test-key' },
};

describe('the stub provider covers every outcome the domain must handle', () => {
  const provider = new StubProvider();

  const call = (identifier: string, endpoint = 'business_verification') =>
    provider.execute({ endpoint, input: { identifications: identifier }, credential: CREDENTIAL });

  it('returns a complete payload on success', async () => {
    const result = await call('7001272184');
    expect(result.outcome).toBe('OK');
    expect(result.authority).toBe('Commercial Registry');
    expect(result.data?.['cr_status']).toBe('ACTIVE');
  });

  it('separates a subject that does not exist from a failure', async () => {
    const result = await call('7000000000');
    // NOT_FOUND is an answer, not an error. It is billed, and ERROR is not.
    expect(result.outcome).toBe('NOT_FOUND');
    expect(result.errorCode).toBeUndefined();
    expect(result.authority).toBe('Commercial Registry');
  });

  it('marks a network failure retryable', async () => {
    const result = await call('7000000001');
    expect(result.outcome).toBe('ERROR');
    expect(result.errorCode).toBe('NETWORK');
    expect(result.retryable).toBe(true);
  });

  it('marks an auth failure not retryable', async () => {
    const result = await call('7000000002');
    expect(result.outcome).toBe('ERROR');
    expect(result.errorCode).toBe('AUTH');
    // Retrying a rejected credential burns the rate limit and changes nothing.
    expect(result.retryable).toBe(false);
  });

  it('returns a success whose payload is missing fields', async () => {
    const result = await call('7000000003');
    expect(result.outcome).toBe('OK');
    expect(result.data?.['cr_status']).toBe('ACTIVE');
    // The case a provider's documentation never shows.
    expect(result.data?.['company_name']).toBeUndefined();
  });

  it('rejects an empty credential rather than pretending to succeed', async () => {
    const result = await provider.execute({
      endpoint: 'business_verification',
      input: { identifications: '7001272184' },
      credential: { ref: 'kms://empty', mode: 'BYOC', material: {} },
    });
    expect(result.errorCode).toBe('AUTH');
  });

  it('refuses an endpoint it does not serve', async () => {
    const result = await provider.execute({
      endpoint: 'not_a_real_endpoint',
      input: {},
      credential: CREDENTIAL,
    });
    expect(result.errorCode).toBe('UNSUPPORTED_ENDPOINT');
  });

  it('answers the same way for the same input', async () => {
    const [first, second] = await Promise.all([call('7001272184'), call('7001272184')]);
    expect(first.data).toEqual(second.data);
  });
});

describe('the registry resolves providers without the domain naming one', () => {
  it('finds every provider able to serve an endpoint', () => {
    const registry = new ProviderRegistry()
      .register(new StubProvider({ name: 'primary' }))
      .register(new StubProvider({ name: 'secondary' }));

    expect(registry.forEndpoint('iban_ownership').map((p) => p.name)).toEqual([
      'primary',
      'secondary',
    ]);
    expect(registry.forEndpoint('nothing')).toEqual([]);
    expect(registry.names()).toEqual(['primary', 'secondary']);
  });
});

describe('credentials come from the binding, not from the environment', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Provider Tenant');
  });

  afterAll(async () => {
    await db.close();
  });

  it('resolves the mode and credential recorded for this tenant and provider', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(
        `INSERT INTO tenant_provider_binding (tenant_id, provider, mode, credential_ref, activated_at)
         VALUES ($1, 'stub', 'BYOC', 'kms://tenants/a/providers/stub', now())`,
        [tenant.tenantId],
      ),
    );

    const secrets = new InMemorySecretStore({
      'kms://tenants/a/providers/stub': { apiKey: 'from-kms' },
    });

    const credential = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveCredential(tx, secrets, 'stub'),
    );

    expect(credential.mode).toBe('BYOC');
    expect(credential.material['apiKey']).toBe('from-kms');
  });

  it('lets one tenant be BYOC on one provider and MANAGED on another', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(
        `INSERT INTO tenant_provider_binding (tenant_id, provider, mode, credential_ref)
         VALUES ($1, 'other', 'MANAGED', 'kms://nx/providers/other')`,
        [tenant.tenantId],
      ),
    );

    const [byoc, managed] = await withTenant(db.appPool, tenant.tenantId, async (tx) => [
      await getProviderBinding(tx, 'stub'),
      await getProviderBinding(tx, 'other'),
    ]);

    // ADR-005: the mode belongs to the pair, not to the tenant.
    expect(byoc?.mode).toBe('BYOC');
    expect(managed?.mode).toBe('MANAGED');
  });

  it('refuses to store anything that is not a KMS reference', async () => {
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query(
          `INSERT INTO tenant_provider_binding (tenant_id, provider, mode, credential_ref)
           VALUES ($1, 'leaky', 'BYOC', 'sk_live_realsecretvalue')`,
          [tenant.tenantId],
        ),
      ),
      // Rule 10, enforced by the database rather than by a code review.
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps bindings inside the tenant that owns them', async () => {
    const other = await seedTenant(db.appPool, 'Provider Other Tenant');
    const binding = await withTenant(db.appPool, other.tenantId, (tx) =>
      getProviderBinding(tx, 'stub'),
    );
    expect(binding).toBeNull();
  });
});
