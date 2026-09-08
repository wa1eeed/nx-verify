import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { issueApiKey } from '../../../packages/core/src/auth/api-keys.js';
import { readAudit } from '../../../packages/core/src/auth/audit.js';
import { registerEndpoint } from '../../../packages/core/src/webhooks/dispatch.js';
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
import { buildApp } from '../src/app.js';
import { buildContext } from '../src/context.js';
import { buildOpenApiDocument } from '../src/openapi.js';
import type { FastifyInstance } from 'fastify';

/**
 * Unit 7 acceptance: the sandbox works from outside, over HTTP, with a real key.
 */

const PROVIDER_NAME = 'wathq-example-connector';

describe('the public API', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let app: FastifyInstance;
  let apiKey: string;
  let readOnlyKey: string;
  let context: ReturnType<typeof buildContext>;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'API Tenant');
    // The provider carries a distinctive name so that a leak into any response body
    // would be unmistakable. Testing against the word "stub" would pass by accident.
    await preparePricedTenant(db.appPool, tenant.tenantId, { providerName: PROVIDER_NAME });

    const issued = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      issueApiKey(tx, {
        name: 'integration',
        scopes: [
          'verifications:write',
          'verifications:read',
          'products:read',
          'entities:read',
          'wallet:read',
        ],
      }),
    );
    apiKey = issued.secret;

    const readOnly = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      issueApiKey(tx, { name: 'read only', scopes: ['products:read'] }),
    );
    readOnlyKey = readOnly.secret;

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
    // The API builds its own pool, so it has to let go before the database is dropped.
    await context.pool.end();
    await db.close();
  });

  const call = (
    method: 'GET' | 'POST',
    url: string,
    options: { key?: string | null; body?: unknown; headers?: Record<string, string> } = {},
  ) =>
    app.inject({
      method,
      url,
      headers: {
        ...(options.key === null ? {} : { authorization: `Bearer ${options.key ?? apiKey}` }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { payload: options.body as object }),
    });

  it('refuses a request with no key', async () => {
    const response = await call('GET', '/v1/products', { key: null });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('NX-4011');
    expect(response.json().error.request_id).toBeTruthy();
  });

  it('refuses a key that does not exist', async () => {
    const response = await call('GET', '/v1/products', { key: 'nx_test_notarealkey' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a key without the scope', async () => {
    const response = await call('POST', '/v1/verifications', {
      key: readOnlyKey,
      body: { product: 'ADDRESS_ONLY', subject: { unn: '7001272184' } },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('NX-4031');
  });

  it('publishes the catalogue with each product schema and price', async () => {
    const response = await call('GET', '/v1/products');
    expect(response.statusCode).toBe(200);

    const body = response.json();
    const address = body.products.find((p: { code: string }) => p.code === 'ADDRESS_ONLY');
    expect(address.input_schema.required).toEqual(['unn']);
    expect(address.price.amount).toBe(8);
    expect(address.price.currency).toBe('SAR');
  });

  it('runs a verification and returns the fixed envelope', async () => {
    const response = await call('POST', '/v1/verifications', {
      body: {
        product: 'ADDRESS_ONLY',
        subject: { unn: '7001272184' },
        reference: 'ENJ-ONB-88213',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe('OK');
    expect(body.entity_id).toBeTruthy();
    expect(body.results.address.status).toBe('OK');
    expect(body.results.address.authority).toBe('Commercial Registry');
    expect(body.billing).toEqual({ amount: 8, currency: 'SAR' });
  });

  it('never names the provider in any response', async () => {
    const created = await call('POST', '/v1/verifications', {
      body: { product: 'KYB_COMPLETE', subject: { unn: '7001272184' } },
    });
    const fetched = await call('GET', `/v1/verifications/${created.json().verification_id}`);
    const products = await call('GET', '/v1/products');

    for (const response of [created, fetched, products]) {
      expect(response.body).not.toContain(PROVIDER_NAME);
    }
    // The authority does survive, which is the whole point of the distinction.
    expect(fetched.body).toContain('OK');
  });

  it('honours Idempotency-Key over HTTP', async () => {
    const key = `http-${randomUUID()}`;
    const body = { product: 'ADDRESS_ONLY', subject: { unn: '7001272184' } };

    const first = await call('POST', '/v1/verifications', {
      body,
      headers: { 'idempotency-key': key },
    });
    const second = await call('POST', '/v1/verifications', {
      body,
      headers: { 'idempotency-key': key },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().verification_id).toBe(first.json().verification_id);
    expect(second.json().replayed).toBe(true);
  });

  it('rejects a subject that fails the product schema with 422 and no charge', async () => {
    const before = await call('GET', '/v1/wallet');
    const response = await call('POST', '/v1/verifications', {
      body: { product: 'ADDRESS_ONLY', subject: { unn: 'nonsense' } },
    });
    const after = await call('GET', '/v1/wallet');

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('NX-4002');
    expect(after.json().balance).toBe(before.json().balance);
  });

  it('rejects a malformed envelope with 400', async () => {
    const response = await call('POST', '/v1/verifications', { body: { subject: {} } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('NX-4001');
  });

  it('returns the live profile with authority and freshness on every field', async () => {
    const created = await call('POST', '/v1/verifications', {
      body: { product: 'KYB_COMPLETE', subject: { unn: '7001272184' } },
    });
    const response = await call('GET', `/v1/entities/${created.json().entity_id}`);

    expect(response.statusCode).toBe(200);
    const fields = response.json().fields;
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(field.authority).toBeTruthy();
      expect(field.observed_at).toBeTruthy();
      expect(['fresh', 'expiring', 'expired', 'permanent']).toContain(field.freshness);
    }
  });

  it('does not let one tenant read another tenant run', async () => {
    const created = await call('POST', '/v1/verifications', {
      body: { product: 'ADDRESS_ONLY', subject: { unn: '7001272184' } },
    });

    const other = await seedTenant(db.appPool, 'API Other Tenant');
    await preparePricedTenant(db.appPool, other.tenantId, { providerName: PROVIDER_NAME });
    const otherKey = await withTenant(db.appPool, other.tenantId, (tx) =>
      issueApiKey(tx, { name: 'other', scopes: ['verifications:read'] }),
    );

    const response = await call('GET', `/v1/verifications/${created.json().verification_id}`, {
      key: otherKey.secret,
    });
    expect(response.statusCode).toBe(404);
  });

  it('records every call in the audit log', async () => {
    await call('POST', '/v1/verifications', {
      body: { product: 'ADDRESS_ONLY', subject: { unn: '7001272184' } },
    });

    const entries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      readAudit(tx, { action: 'verification.created' }),
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.actorType).toBe('API_KEY');
    expect(entries[0]?.requestId).toBeTruthy();
  });

  it('queues a webhook for a completed verification', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      registerEndpoint(tx, {
        url: 'https://customer.example/hooks/nx',
        secretRef: 'kms://tenants/api/webhooks/1',
        events: ['verification.completed'],
      }),
    );

    const created = await call('POST', '/v1/verifications', {
      body: { product: 'ADDRESS_ONLY', subject: { unn: '7001272184' }, reference: 'ENJ-1' },
    });

    expect(created.statusCode).toBe(201);
    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ payload: { verification_id: string; client_ref: string } }>(
        `SELECT payload FROM webhook_deliveries WHERE event_type = 'verification.completed'
         ORDER BY created_at DESC LIMIT 1`,
      ),
    );

    expect(rows[0]?.payload.verification_id).toBe(created.json().verification_id);
    // client_ref is echoed on every later event, which is what makes the integration work
    // with one field on the customer's side.
    expect(rows[0]?.payload.client_ref).toBe('ENJ-1');
  });

  it('returns an evidence link and a public page that shows only the seal', async () => {
    const created = await call('POST', '/v1/verifications', {
      body: { product: 'KYB_COMPLETE', subject: { unn: '7001272184' } },
    });

    const evidenceUrl = created.json().evidence_url as string;
    expect(evidenceUrl).toMatch(/^\/v1\/evidence\//);

    // No key. Whoever scans the code on a printed document has no account here.
    const publicPage = await call('GET', evidenceUrl, { key: null });
    expect(publicPage.statusCode).toBe(200);

    const body = publicPage.json();
    expect(body.content_hash).toHaveLength(64);
    expect(body.sealed_at).toBeTruthy();
    // It confirms the seal and says so, and shows nothing about the subject.
    expect(publicPage.body).not.toContain('7001272184');
    expect(publicPage.body).not.toContain(created.json().entity_id);
    expect(body.note_ar).toContain('لا تعرض أي بيانات شخصية');
  });

  it('refuses an unknown evidence token', async () => {
    const response = await call('GET', '/v1/evidence/not-a-real-token', { key: null });
    expect(response.statusCode).toBe(404);
  });

  it('serves an OpenAPI document generated from the routes', async () => {
    const response = await call('GET', '/openapi.json', { key: null });
    expect(response.statusCode).toBe(200);

    const document = response.json();
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toContain('/v1/verifications');
    expect(document.paths['/v1/verifications'].post.parameters[0].name).toBe('Idempotency-Key');
    expect(JSON.stringify(document)).not.toContain(PROVIDER_NAME);
  });

  it('builds the same document offline for publishing', () => {
    const document = buildOpenApiDocument({ serverUrl: 'https://sandbox.nx.sa' });
    expect((document['servers'] as { url: string }[])[0]?.url).toBe('https://sandbox.nx.sa');
  });
});
