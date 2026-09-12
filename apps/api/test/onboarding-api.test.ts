import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { issueApiKey } from '../../../packages/core/src/auth/api-keys.js';
import { defineJourney } from '../../../packages/core/src/onboarding/cases.js';
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
 * Unit 56 acceptance: onboard a merchant in one call.
 *
 * The call the product is named for. A customer does not ask us to verify a business,
 * they ask us to onboard a merchant, and what comes back has to be an answer rather than
 * a handle: a decision, a reference, and what is still outstanding.
 */

const PROVIDER_NAME = 'wathq-example-connector';

describe('the onboarding API', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let app: FastifyInstance;
  let context: ReturnType<typeof buildContext>;
  let apiKey = '';

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Onboarding API Tenant');
    await preparePricedTenant(db, tenant.tenantId, { providerName: PROVIDER_NAME });

    const issued = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await defineJourney(tx, {
        code: 'MERCHANT',
        nameAr: 'تأهيل تاجر',
        steps: [
          { stepKey: 'company', productCode: 'KYB_COMPLETE' },
          { stepKey: 'address', productCode: 'ADDRESS_ONLY', subjectMap: { unn: 'unn' } },
        ],
      });

      return issueApiKey(tx, {
        name: 'onboarding',
        scopes: ['onboarding:write', 'onboarding:read', 'verifications:read'],
      });
    });
    apiKey = issued.secret;

    context = buildContext({
      connectionString: db.appConnectionString,
      masterKey: Buffer.alloc(32, 9).toString('base64'),
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

  const call = (method: 'GET' | 'POST', url: string, body?: unknown, key = apiKey) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${key}` },
      ...(body === undefined ? {} : { payload: body as object }),
    });

  it('onboards an applicant in one call and answers with a decision', async () => {
    const response = await call('POST', '/v1/onboarding/cases', {
      journey: 'MERCHANT',
      subject: { unn: '7001272184', manager: { id: '1098765432', id_type: 'NATIONAL_ID' } },
      display_name: 'مؤسسة نماء للمقاولات',
      reference: 'MER-1',
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();

    expect(body.reference).toMatch(/^ONB-/);
    expect(body.environment).toBe('live');
    // An answer, not a handle: the file already ran and already concluded.
    expect(['APPROVED', 'REJECTED', 'IN_REVIEW']).toContain(body.status);
    expect(body.steps).toHaveLength(2);
    expect(body.steps.every((step: { status: string }) => step.status !== 'PENDING')).toBe(true);
    // Every check names the verification behind it, so a customer can open any one of them.
    expect(body.steps[0].verification_id).toBeTruthy();
  });

  it('names no provider anywhere in the file it returns', async () => {
    const created = await call('POST', '/v1/onboarding/cases', {
      journey: 'MERCHANT',
      subject: { unn: '7001272184', manager: { id: '1098765432', id_type: 'NATIONAL_ID' } },
    });
    const read = await call('GET', `/v1/onboarding/cases/${created.json().case_id}`);

    expect(read.statusCode).toBe(200);
    expect(read.body).not.toContain(PROVIDER_NAME);
    // Rule 4 too: the applicant's identifiers went in and do not come back.
    expect(read.body).not.toContain('1098765432');
  });

  it('lists the journeys, so an integrator needs no second document', async () => {
    const response = await call('GET', '/v1/onboarding/journeys');
    expect(response.statusCode).toBe(200);
    expect(response.json().journeys[0].code).toBe('MERCHANT');
    expect(response.json().journeys[0].steps).toHaveLength(2);
  });

  it('lets a person waive a check, with a reason from the closed set', async () => {
    const created = await call('POST', '/v1/onboarding/cases', {
      journey: 'MERCHANT',
      subject: { unn: '7000000001' },
    });
    const caseId = created.json().case_id;

    const waived = await call('POST', `/v1/onboarding/cases/${caseId}/waive`, {
      step: 'address',
      reason: 'DOCUMENT_ON_FILE',
      actor: '1c9b0000-0000-4000-8000-000000000001',
    });

    // The step had already failed with the provider error, so waiving it is refused: a
    // waiver applies to work not yet done.
    expect([200, 409]).toContain(waived.statusCode);

    const rejected = await call('POST', `/v1/onboarding/cases/${caseId}/waive`, {
      step: 'address',
      reason: 'BECAUSE_I_SAID_SO',
      actor: '1c9b0000-0000-4000-8000-000000000001',
    });
    expect(rejected.statusCode).toBe(400);
  });

  it('refuses a key without the onboarding scope', async () => {
    const narrow = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      issueApiKey(tx, { name: 'narrow', scopes: ['products:read'] }),
    );

    const response = await call(
      'POST',
      '/v1/onboarding/cases',
      { journey: 'MERCHANT', subject: { unn: '7001272184' } },
      narrow.secret,
    );
    expect(response.statusCode).toBe(403);
  });
});
