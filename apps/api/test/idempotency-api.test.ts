import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { issueApiKey } from '../../../packages/core/src/auth/api-keys.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import {
  InMemorySecretStore,
  ProviderRegistry,
  StubProvider,
} from '../../../packages/providers/src/index.js';
import { buildApp } from '../src/app.js';
import { buildContext } from '../src/context.js';
import type { FastifyInstance } from 'fastify';

/**
 * Rule 7 measured where the rule is written: over HTTP, on an endpoint that is not a
 * verification (ADR-183).
 *
 * Guard 03 has always been green and has never covered this. It calls `runVerification`, a
 * domain function, and `verification_runs` holds its own key in a unique index. So the guard
 * proved the one endpoint that already worked, while opening an onboarding file, creating a
 * batch, confirming it and starting a monitor honoured the header nowhere. Six endpoints that
 * spend the subscriber's money, and a retry after a network timeout charged twice.
 *
 * `/v1/portfolios` is the subject here because it is the cheapest POST to repeat and the
 * assertions are about the layer rather than about portfolios: one row, one answer, replayed.
 */

const SECRET_REF = 'kms://providers/test/api-key';
const SCOPES = ['portfolios:read', 'portfolios:write', 'products:read'];

describe('every POST honours the key, not one of them', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let other: SeededTenant;
  let app: FastifyInstance;
  let context: ReturnType<typeof buildContext>;
  let apiKey: string;
  let otherKey: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'شركة المفتاح');
    other = await seedTenant(db.appPool, 'شركة أخرى');

    const issued = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      issueApiKey(tx, { name: 'keys', scopes: SCOPES }),
    );
    apiKey = issued.secret;
    const issuedOther = await withTenant(db.appPool, other.tenantId, (tx) =>
      issueApiKey(tx, { name: 'keys', scopes: SCOPES }),
    );
    otherKey = issuedOther.secret;

    context = buildContext({
      connectionString: db.appConnectionString,
      masterKey: Buffer.alloc(32, 7).toString('base64'),
      registry: new ProviderRegistry().register(new StubProvider({ name: 'test-connector' })),
      secrets: new InMemorySecretStore({ [SECRET_REF]: { apiKey: 'test-key' } }),
    });
    app = await buildApp({ context });
  });

  afterAll(async () => {
    await app.close();
    await context.pool.end();
    await db.close();
  });

  const post = (url: string, body: unknown, options: { key?: string; idem?: string } = {}) =>
    app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${options.key ?? apiKey}`,
        ...(options.idem === undefined ? {} : { 'idempotency-key': options.idem }),
      },
      payload: body as object,
    });

  const portfolios = async (key?: string): Promise<number> => {
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/portfolios',
      headers: { authorization: `Bearer ${key ?? apiKey}` },
    });
    return (listed.json().portfolios as unknown[]).length;
  };

  it('does the work once and replays the same answer, byte for byte', async () => {
    const body = { code: 'PF_ONE', name_ar: 'مجموعة الاختبار', name_en: 'Test portfolio' };

    const first = await post('/v1/portfolios', body, { idem: 'key-one' });
    expect(first.statusCode).toBe(201);
    expect(first.headers['idempotency-replayed']).toBeUndefined();
    const after = await portfolios();

    const second = await post('/v1/portfolios', body, { idem: 'key-one' });
    // The same status, the same bytes, and said to be a replay rather than a second create.
    expect(second.statusCode).toBe(first.statusCode);
    expect(second.body).toBe(first.body);
    expect(second.headers['idempotency-replayed']).toBe('true');

    // And the decisive assertion: nothing was created the second time.
    expect(await portfolios()).toBe(after);
  });

  it('refuses the same key on a different request instead of answering the old one', async () => {
    const refused = await post(
      '/v1/portfolios',
      { code: 'PF_TWO', name_ar: 'مجموعة مختلفة', name_en: 'Different portfolio' },
      { idem: 'key-one' },
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('NX-4092');
    // Not retryable: it is a bug in the integration, and answering the earlier request
    // silently would be the platform deciding that the call just made did not happen.
    expect(refused.json().error.retryable).toBe(false);
  });

  it('keeps one workspace out of another workspace keyspace', async () => {
    // The same key text, from another subscriber, is another request. The primary key says
    // so rather than a WHERE clause (rule 2).
    const theirs = await post(
      '/v1/portfolios',
      { code: 'PF_ONE', name_ar: 'مجموعتهم', name_en: 'Their portfolio' },
      { key: otherKey, idem: 'key-one' },
    );
    expect(theirs.statusCode).toBe(201);
    expect(theirs.headers['idempotency-replayed']).toBeUndefined();
    expect(await portfolios(otherKey)).toBe(1);
  });

  it('lets the key go when the request was refused, so a fixed payload may reuse it', async () => {
    // A body the route rejects. Nothing happened, so nothing is worth replaying.
    const bad = await post('/v1/portfolios', { code: '' }, { idem: 'key-two' });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);

    const good = await post(
      '/v1/portfolios',
      { code: 'PF_FIXED', name_ar: 'مجموعة صحيحة', name_en: 'Fixed portfolio' },
      { idem: 'key-two' },
    );
    expect(good.statusCode).toBe(201);
  });

  it('runs a request with no key exactly as it always did', async () => {
    // Rule 7 says accepts and honours, not requires: a mandatory header would break every
    // integration that exists.
    const before = await portfolios();
    const one = await post('/v1/portfolios', {
      code: 'PF_NOKEY_A',
      name_ar: 'بلا مفتاح',
      name_en: 'No key A',
    });
    const two = await post('/v1/portfolios', {
      code: 'PF_NOKEY_B',
      name_ar: 'بلا مفتاح',
      name_en: 'No key B',
    });
    expect(one.statusCode).toBe(201);
    expect(two.statusCode).toBe(201);
    expect(await portfolios()).toBe(before + 2);
  });

  it('never stores the request body, only a fingerprint of it', async () => {
    // Rule 4: the body of a POST carries the subject, and the subject carries a national id.
    // What is kept is an HMAC keyed with the workspace's own key, which answers the only
    // question asked of it and is not a search away from the value it was taken over.
    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ request_fingerprint: string; route: string; response_body: string }>(
        `SELECT request_fingerprint, route, response_body FROM idempotent_requests
          WHERE tenant_id = $1 ORDER BY claimed_at`,
        [tx.tenantId],
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.request_fingerprint).toMatch(/^[0-9a-f]{64}$/);
      // The route pattern, never a resolved path carrying a value.
      expect(row.route).toBe('/v1/portfolios');
      expect(row.response_body).not.toContain('مجموعة الاختبار');
    }
  });
});
