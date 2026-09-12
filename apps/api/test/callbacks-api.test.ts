import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setCallback } from '../../../packages/core/src/webhooks/inbound.js';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';
import {
  InMemorySecretStore,
  ProviderRegistry,
  StubProvider,
} from '../../../packages/providers/src/index.js';
import { buildApp } from '../src/app.js';
import { buildContext } from '../src/context.js';
import type { FastifyInstance } from 'fastify';

/**
 * Unit 60 acceptance, over HTTP: the one route with no API key lets nothing through that
 * a provider did not sign.
 */

const WEBHOOK_SECRET = 'the-shared-webhook-secret';
const SECRET_REF = 'kms://providers/openbank/webhook';

describe('the provider callback endpoint', () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let context: ReturnType<typeof buildContext>;
  let slug: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.operatorPool.query(
      `INSERT INTO provider_catalog (code, name_ar, name_en, endpoints)
       VALUES ('openbank', 'مصرفي مفتوح', 'Open bank', '{iban_ownership}')
       ON CONFLICT (code) DO NOTHING`,
    );
    await db.operatorPool.query(
      `INSERT INTO provider_connections (provider, environment, kind, base_url, auth_url)
       VALUES ('openbank', 'sandbox', 'openbanking', 'https://api.example.com',
               'https://auth.example.com/oauth2/token')
       ON CONFLICT (provider, environment) DO NOTHING`,
    );
    ({ slug } = await setCallback(db.operatorPool, {
      provider: 'openbank',
      environment: 'sandbox',
      secretRef: SECRET_REF,
      header: 'lean-signature',
      algorithm: 'sha512',
    }));

    context = buildContext({
      connectionString: db.appConnectionString,
      masterKey: Buffer.alloc(32, 7).toString('base64'),
      registry: new ProviderRegistry().register(new StubProvider({ name: 'openbank' })),
      secrets: new InMemorySecretStore({ [SECRET_REF]: { webhookSecret: WEBHOOK_SECRET } }),
    });

    app = await buildApp({ context });
  });

  afterAll(async () => {
    await app.close();
    await context.pool.end();
    await db.close();
  });

  const deliver = (body: string, options: { signature?: string | null; path?: string } = {}) => {
    const signature =
      options.signature === undefined
        ? `sha512=${createHmac('sha512', WEBHOOK_SECRET).update(Buffer.from(body, 'utf8')).digest('hex')}`
        : options.signature;

    return app.inject({
      method: 'POST',
      url: options.path ?? `/v1/callbacks/${slug}`,
      headers: {
        'content-type': 'application/json',
        ...(signature === null ? {} : { 'lean-signature': signature }),
      },
      payload: body,
    });
  };

  it('accepts a signed delivery and needs no API key to do it', async () => {
    const response = await deliver('{"id":"evt_ok","type":"entity.data.refresh.updated"}');
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ received: true, duplicate: false });
  });

  it('treats a redelivery as the same event', async () => {
    const body = '{"id":"evt_retry","type":"entity.data.refresh.updated"}';
    expect((await deliver(body)).json().duplicate).toBe(false);
    const second = await deliver(body);
    expect(second.statusCode).toBe(202);
    expect(second.json().duplicate).toBe(true);
  });

  it('refuses an unsigned delivery', async () => {
    const response = await deliver('{"id":"evt_bare"}', { signature: null });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('NX-4011');
  });

  it('refuses a signature over a different body', async () => {
    const signed = createHmac('sha512', WEBHOOK_SECRET)
      .update(Buffer.from('{"id":"evt_a"}', 'utf8'))
      .digest('hex');
    const response = await deliver('{"id":"evt_b"}', { signature: `sha512=${signed}` });
    expect(response.statusCode).toBe(401);
  });

  it('answers an unknown address the way it answers an unknown path', async () => {
    const response = await deliver('{"id":"evt_nowhere"}', {
      path: '/v1/callbacks/not-an-address',
    });
    // Not 401. Telling a stranger that an address exists but the signature was wrong
    // turns this endpoint into a way to find live callback addresses.
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NX-4041');
  });

  it('names no provider in anything it answers', async () => {
    const accepted = await deliver('{"id":"evt_quiet","type":"entity.updated"}');
    const refused = await deliver('{"id":"evt_quiet2"}', { signature: 'sha512=deadbeef' });
    const missing = await deliver('{"id":"evt_quiet3"}', { path: '/v1/callbacks/nothing-here' });

    for (const response of [accepted, refused, missing]) {
      expect(response.body).not.toContain('openbank');
    }
  });
});
