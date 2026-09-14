import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { createRequest, getRequest } from '../../../packages/core/src/customers/requests.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';
import { SANDBOX_UNN } from '../../../packages/providers/src/stub/verification-sandbox.js';
import { runVerificationRequests } from '../src/jobs/requests.js';

/**
 * The worker's sweep of verification requests: it finishes what the console left behind,
 * builds nothing for a workspace with nothing waiting, and never reaches another's.
 */

describe('the verification requests sweep', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let idle: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Sweep Tenant');
    idle = await seedTenant(db.appPool, 'Idle Tenant');
    await preparePricedTenant(db, tenant.tenantId, { balanceHalalas: 5_000_00 });
    await preparePricedTenant(db, idle.tenantId, { balanceHalalas: 5_000_00 });
  });

  afterAll(async () => {
    await db.close();
  });

  const sweep = (tenantId: string, registryFor: () => Promise<typeof fixture.registry>) =>
    withTenant(db.appPool, tenantId, (tx) =>
      runVerificationRequests(tx, {
        keys,
        secrets: fixture.secrets,
        registryFor,
        inTenant: (work) => withTenant(db.appPool, tenantId, work),
        graceSeconds: 0,
        retryDelaySeconds: 0,
      }),
    );

  it('finishes a request nobody is running', async () => {
    const created = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createRequest(tx, keys, {
        kind: 'COMPANY',
        subject: { number: SANDBOX_UNN.ACTIVE },
        productCodes: ['CR_FULL', 'NATIONAL_ADDRESS'],
        bundleKey: randomUUID(),
        requestedBy: null,
      }),
    );
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(
        `UPDATE verification_requests SET submitted_at = now() - interval '1 minute'
         WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, created.requestId],
      ),
    );

    expect(await sweep(tenant.tenantId, async () => fixture.registry)).toBe(1);

    const view = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getRequest(tx, keys, created.requestId),
    );
    expect(view?.status).toBe('DONE');
    expect(view?.checks.map((check) => check.outcome)).toEqual(['OK', 'OK']);
  });

  it('builds no connection for a workspace with nothing waiting', async () => {
    let built = 0;
    const count = await sweep(idle.tenantId, async () => {
      built += 1;
      return fixture.registry;
    });
    expect(count).toBe(0);
    expect(built).toBe(0);
  });
});
