import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { issueApiKey } from '../../../packages/core/src/auth/api-keys.js';
import { createUser } from '../../../packages/core/src/auth/users.js';
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
import type { FastifyInstance } from 'fastify';

/**
 * The operational API.
 *
 * A compliance team that has to open a browser to approve a case cannot put this platform
 * inside their own workflow, and being inside their workflow is what makes it hard to
 * replace.
 */

const PROVIDER_NAME = 'wathq-example-connector';
let ANALYST = '';
let APPROVER = '';

const SCOPES = [
  'verifications:write',
  'verifications:read',
  'products:read',
  'entities:read',
  'wallet:read',
  'review:read',
  'review:write',
  'review:approve',
  'portfolios:read',
  'portfolios:write',
  'batches:read',
  'batches:write',
  'monitors:write',
  'reports:read',
];

describe('the operational API', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let app: FastifyInstance;
  let apiKey: string;
  let context: ReturnType<typeof buildContext>;
  let entityId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Operations Tenant');
    await preparePricedTenant(db.appPool, tenant.tenantId, {
      providerName: PROVIDER_NAME,
      balanceHalalas: 5_000_00,
    });

    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      ANALYST = await createUser(tx, {
        email: 'analyst@ops.sa',
        displayName: 'محلل',
        role: 'ANALYST',
      });
      APPROVER = await createUser(tx, {
        email: 'manager@ops.sa',
        displayName: 'معتمد',
        role: 'APPROVER',
      });
    });

    const issued = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      issueApiKey(tx, { name: 'ops', scopes: SCOPES }),
    );
    apiKey = issued.secret;

    context = buildContext({
      connectionString: db.appConnectionString,
      masterKey: Buffer.alloc(32, 7).toString('base64'),
      registry: new ProviderRegistry().register(new StubProvider({ name: PROVIDER_NAME })),
      secrets: new InMemorySecretStore({ [SECRET_REF]: { apiKey: 'test-key' } }),
    });
    app = await buildApp({ context });

    // A record with no address, which the default rules send to review.
    const created = await call('POST', '/v1/verifications', {
      body: { product: 'KYB_COMPLETE', subject: { unn: '7000000003' } },
    });
    entityId = created.json().entity_id;
    expect(created.json().decision).toBe('REVIEW');
  });

  afterAll(async () => {
    await app.close();
    await context.pool.end();
    await db.close();
  });

  const call = (
    method: 'GET' | 'POST',
    url: string,
    options: { body?: unknown; key?: string | null } = {},
  ) =>
    app.inject({
      method,
      url,
      headers: options.key === null ? {} : { authorization: `Bearer ${options.key ?? apiKey}` },
      ...(options.body === undefined ? {} : { payload: options.body as object }),
    });

  it('lists the review queue with its ages and what is late', async () => {
    const response = await call('GET', '/v1/review-cases');
    expect(response.statusCode).toBe(200);

    const cases = response.json().cases;
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0].reasons.length).toBeGreaterThan(0);
    expect(typeof cases[0].age_hours).toBe('number');
  });

  it('carries a case through assignment, decision and approval', async () => {
    const caseId = (await call('GET', '/v1/review-cases')).json().cases[0].case_id;

    expect(
      (await call('POST', `/v1/review-cases/${caseId}/assign`, { body: { actor: ANALYST } }))
        .statusCode,
    ).toBe(200);

    const decided = await call('POST', `/v1/review-cases/${caseId}/decide`, {
      body: { outcome: 'PASS', actor: ANALYST, note: 'تم التحقق من العنوان يدوياً.' },
    });
    expect(decided.statusCode).toBe(200);

    const approved = await call('POST', `/v1/review-cases/${caseId}/approve`, {
      body: { actor: APPROVER },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('CLOSED');
  });

  it('refuses an approval from the person who decided, over HTTP', async () => {
    const created = await call('POST', '/v1/verifications', {
      body: { product: 'KYB_COMPLETE', subject: { unn: '7000000003' } },
    });
    expect(created.json().decision).toBe('REVIEW');

    const open = (await call('GET', '/v1/review-cases?status=OPEN')).json().cases[0];
    await call('POST', `/v1/review-cases/${open.case_id}/decide`, {
      body: { outcome: 'FAIL', actor: ANALYST, note: 'مستندات ناقصة.' },
    });

    const response = await call('POST', `/v1/review-cases/${open.case_id}/approve`, {
      body: { actor: ANALYST },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('NX-4031');
  });

  it('refuses a decision with no written reason', async () => {
    const response = await call(
      'POST',
      '/v1/review-cases/00000000-0000-4000-8000-000000000000/decide',
      {
        body: { outcome: 'PASS', actor: ANALYST, note: '' },
      },
    );
    expect(response.statusCode).toBe(400);
  });

  it('creates a portfolio and reports that joining it starts monitoring', async () => {
    const created = await call('POST', '/v1/portfolios', {
      body: {
        code: 'API_WATCHED',
        name_ar: 'محفظة مراقبة',
        name_en: 'Watched',
        default_product: 'KYB_COMPLETE',
        monitor: { cadence: 'WEEKLY', budget: 300 },
      },
    });
    expect(created.statusCode).toBe(201);

    const joined = await call('POST', `/v1/portfolios/${created.json().portfolio_id}/members`, {
      body: { entity_id: entityId, actor: ANALYST },
    });

    expect(joined.statusCode).toBe(201);
    // The caller is told that this started monitoring and can therefore see what it will
    // cost them, rather than discovering it on an invoice.
    expect(joined.json().monitor_id).toBeTruthy();

    const list = await call('GET', '/v1/portfolios');
    const portfolio = list
      .json()
      .portfolios.find((p: { code: string }) => p.code === 'API_WATCHED');
    expect(portfolio.monitoring.budget).toBe(300);
    expect(portfolio.monitoring.currency).toBe('SAR');
  });

  it('previews a batch, then runs only what was confirmed', async () => {
    const preview = await call('POST', '/v1/batches/preview', {
      body: { product: 'ADDRESS_ONLY', actor: ANALYST, criteria: { entity_type: 'BUSINESS' } },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().currency).toBe('SAR');

    const created = await call('POST', '/v1/batches', {
      body: { product: 'ADDRESS_ONLY', actor: ANALYST, criteria: { entity_type: 'BUSINESS' } },
    });
    const batchId = created.json().batch_id;
    const estimate = created.json().estimated_cost;

    const wrong = await call('POST', `/v1/batches/${batchId}/confirm`, {
      body: { actor: ANALYST, accepted_cost: estimate + 5 },
    });
    // Someone agreed to a figure. The system holds itself to it.
    expect(wrong.statusCode).toBe(422);

    const right = await call('POST', `/v1/batches/${batchId}/confirm`, {
      body: { actor: ANALYST, accepted_cost: estimate },
    });
    expect(right.statusCode).toBe(200);

    const batch = await call('GET', `/v1/batches/${batchId}`);
    expect(batch.json().status).toBe('CONFIRMED');
    expect(batch.json().currency).toBe('SAR');
  });

  it('refuses a monitor with no budget', async () => {
    const response = await call('POST', '/v1/monitors', {
      body: {
        entity_id: entityId,
        product: 'KYB_COMPLETE',
        fields: ['cr.status'],
        cadence: 'DAILY',
        budget: 0,
        actor: ANALYST,
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('creates a monitor with a budget and a named activator', async () => {
    const response = await call('POST', '/v1/monitors', {
      body: {
        entity_id: entityId,
        product: 'KYB_COMPLETE',
        fields: ['cr.status'],
        cadence: 'MONTHLY',
        budget: 150,
        actor: ANALYST,
        consent_ref: 'DPA-2026-77',
      },
    });

    expect(response.statusCode).toBe(201);
    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ activated_by: string; consent_ref: string }>(
        `SELECT activated_by, consent_ref FROM monitors WHERE id = $1`,
        [response.json().monitor_id],
      ),
    );
    expect(rows[0]?.activated_by).toBe(ANALYST);
    expect(rows[0]?.consent_ref).toBe('DPA-2026-77');
  });

  it('reports the dashboard and the monthly figures in riyals', async () => {
    const dashboard = await call('GET', '/v1/dashboard');
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().wallet.currency).toBe('SAR');
    expect(dashboard.json().entities).toBeGreaterThan(0);

    const report = await call('GET', '/v1/reports/monthly');
    expect(report.statusCode).toBe(200);
    expect(report.json().spend.currency).toBe('SAR');
    // Halalas are an internal representation and stay internal.
    expect(Number.isInteger(report.json().spend.total * 100)).toBe(true);
  });

  it('rejects a malformed month', async () => {
    const response = await call('GET', '/v1/reports/monthly?month=not-a-month');
    expect(response.statusCode).toBe(400);
  });

  it('names no provider on any operational response', async () => {
    for (const url of [
      '/v1/review-cases',
      '/v1/portfolios',
      '/v1/dashboard',
      '/v1/reports/monthly',
    ]) {
      const response = await call('GET', url);
      expect(response.body).not.toContain(PROVIDER_NAME);
    }
  });

  it('refuses every operational endpoint without the right scope', async () => {
    const limited = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      issueApiKey(tx, { name: 'limited', scopes: ['products:read'] }),
    );

    for (const url of ['/v1/review-cases', '/v1/portfolios', '/v1/dashboard']) {
      const response = await call('GET', url, { key: limited.secret });
      expect(response.statusCode, url).toBe(403);
    }
  });
});
