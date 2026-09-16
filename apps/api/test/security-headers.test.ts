import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { SECRET_REF, preparePricedTenant } from '../../../test/helpers/billing.js';
import {
  InMemorySecretStore,
  ProviderRegistry,
  StubProvider,
} from '../../../packages/providers/src/index.js';
import { withTenant } from '../../../packages/db/src/client.js';
import { issueApiKey } from '../../../packages/core/src/auth/api-keys.js';
import { buildApp } from '../src/app.js';
import { buildContext } from '../src/context.js';
import type { FastifyInstance } from 'fastify';

/**
 * The headers on every answer the API gives (SEC-03).
 *
 * Read from real responses rather than from the code that sets them: a header added to the
 * wrong hook, or lost to an error handler that replies on its own, is exactly the kind of gap
 * a test of the function alone would miss.
 */

const PROVIDER_NAME = 'wathq-example-connector';

describe('the API says the same thing to every browser', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let app: FastifyInstance;
  let context: ReturnType<typeof buildContext>;
  let apiKey = '';

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Headers Tenant');
    await preparePricedTenant(db, tenant.tenantId, {
      providerName: PROVIDER_NAME,
      balanceHalalas: 100_00,
    });
    apiKey = (
      await withTenant(db.appPool, tenant.tenantId, (tx) =>
        issueApiKey(tx, { name: 'headers', scopes: ['products:read'] }),
      )
    ).secret;
    context = buildContext({
      connectionString: db.appConnectionString,
      masterKey: Buffer.alloc(32, 7).toString('base64'),
      registry: new ProviderRegistry().register(new StubProvider({ name: PROVIDER_NAME })),
      secrets: new InMemorySecretStore({ [SECRET_REF]: { apiKey: 'test-key' } }),
    });
    app = await buildApp({ context });
  });

  afterAll(async () => {
    await app.close();
    await context.pool.end();
    await db.close();
  });

  const headersOf = async (url: string, authorized = true) => {
    const response = await app.inject({
      method: 'GET',
      url,
      headers: authorized ? { authorization: `Bearer ${apiKey}` } : {},
    });
    return { status: response.statusCode, headers: response.headers };
  };

  it('sets them on an answer, on a refusal and on a health check alike', async () => {
    for (const [url, authorized] of [
      ['/health', false],
      ['/v1/products', true],
      ['/v1/products', false],
      ['/v1/verifications/not-a-run', true],
    ] as const) {
      const { headers } = await headersOf(url, authorized);
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['referrer-policy']).toBe('no-referrer');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['cache-control']).toBe('no-store');
      expect(String(headers['content-security-policy'])).toContain("default-src 'none'");
      expect(String(headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    }
  });

  it('names no software and no version', async () => {
    const { headers } = await headersOf('/health', false);
    expect(headers['x-powered-by']).toBeUndefined();
    expect(headers['server']).toBeUndefined();
  });

  it('holds a person back from https only where there is https to hold them to', async () => {
    const { headers } = await headersOf('/health', false);
    // Tests run outside production, where a browser told to refuse plain http could not
    // reach a development console on the same host again.
    expect(headers['strict-transport-security']).toBeUndefined();
  });

  it('lets the sealed document carry its own appearance, and nothing else', async () => {
    const { headers } = await headersOf('/health', false);
    const policy = String(headers['content-security-policy']);
    expect(policy).toContain("style-src 'unsafe-inline'");
    expect(policy).not.toContain('script-src');
    expect(policy).not.toMatch(/script-src[^;]*unsafe/);
  });
});
