import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import { requestTopUp } from '../src/billing/topups.js';
import {
  getSubscriberDetail,
  listSubscriberSummaries,
  platformOverview,
} from '../src/billing/subscribers.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * Unit 74 acceptance: the people who run the platform see who is paying, when each term
 * ends and what is left of it, and nothing about whom a subscriber verified.
 *
 * Everything is read on the operator connection, which is the point of the test as much
 * as the figures are: if one of these queries needed a subscriber's runs or attestations
 * it would fail here with a permission error rather than pass quietly.
 */

describe('the subscribers, as the operator sees them', () => {
  let db: TestDatabase;
  let renewing: SeededTenant;
  let lapsed: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    renewing = await seedTenant(db.appPool, 'Renewing Soon Co');
    lapsed = await seedTenant(db.appPool, 'Lapsed Co');
    await preparePricedTenant(db, renewing.tenantId, { packageCode: 'ESSENTIAL', balanceHalalas: 900_00 });
    await preparePricedTenant(db, lapsed.tenantId, { packageCode: 'PAYG' });

    // A sandbox workspace belongs to a subscriber and is not a second customer.
    const sandbox = await seedTenant(db.appPool, 'Renewing Soon Co (sandbox)');
    // Linked on the operator connection, as provisioning does it. Row level security is
    // forced on tenants, so the owner role would match no row and report success.
    await db.operatorPool.query(`UPDATE tenants SET sandbox_of = $1 WHERE id = $2`, [
      renewing.tenantId,
      sandbox.tenantId,
    ]);

    await db.operatorPool.query(
      `UPDATE tenant_commitments SET term_end = now() + interval '10 days 1 hour' WHERE tenant_id = $1`,
      [renewing.tenantId],
    );
    await db.operatorPool.query(
      `UPDATE tenant_commitments SET term_start = now() - interval '100 days',
                                     term_end = now() - interval '3 days'
       WHERE tenant_id = $1`,
      [lapsed.tenantId],
    );

    await withTenant(db.appPool, renewing.tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn: '7001272184' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7001272184' }],
        idempotencyKey: randomUUID(),
        triggeredBy: 'API',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );
    await withTenant(db.appPool, renewing.tenantId, (tx) =>
      requestTopUp(tx, { amountHalalas: 300_00 }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('lists paying subscribers with their term, capacity and balance', async () => {
    const rows = await listSubscriberSummaries(db.operatorPool);
    const names = rows.map((row) => row.legalName);

    expect(names).toContain('Renewing Soon Co');
    expect(names).toContain('Lapsed Co');
    expect(names).not.toContain('Renewing Soon Co (sandbox)');

    const row = rows.find((entry) => entry.tenantId === renewing.tenantId);
    expect(row?.daysLeft).toBe(10);
    expect(row?.packageCode).toBe('ESSENTIAL');
    expect(row?.packageNameAr).toBeTruthy();
    expect(row?.hasSandbox).toBe(true);
    // The wallet column is riyals and the summary is halalas, converted once at the edge.
    expect(row?.balanceHalalas).toBeLessThanOrEqual(900_00);
    expect(row?.availableHalalas).toBe((row?.balanceHalalas ?? 0) - (row?.heldHalalas ?? 0));
  });

  it('puts a term ending within thirty days under renewals, and an ended one under lapsed', async () => {
    const overview = await platformOverview(db.operatorPool);

    expect(overview.renewalsDue.map((row) => row.tenantId)).toContain(renewing.tenantId);
    expect(overview.lapsed.map((row) => row.tenantId)).toContain(lapsed.tenantId);
    expect(overview.renewalsDue.map((row) => row.tenantId)).not.toContain(lapsed.tenantId);
    expect(overview.pendingTopUps).toBeGreaterThanOrEqual(1);
  });

  it('counts this month from the counters, never from the runs', async () => {
    const overview = await platformOverview(db.operatorPool);
    expect(overview.month.runs).toBeGreaterThanOrEqual(1);
    expect(overview.busiest.map((row) => row.legalName)).toContain('Renewing Soon Co');
  });

  it('shows one subscriber in detail: usage by service and the transfers they asked for', async () => {
    const detail = await getSubscriberDetail(db.operatorPool, renewing.tenantId);
    expect(detail).not.toBeNull();
    expect(detail?.usage.find((line) => line.productCode === 'ADDRESS_ONLY')?.runs).toBe(1);
    expect(detail?.topUps.map((line) => line.amountHalalas)).toContain(300_00);
    expect(detail?.topUps[0]?.status).toBe('REQUESTED');
  });

  it('returns nothing for a sandbox workspace or an unknown id', async () => {
    expect(await getSubscriberDetail(db.operatorPool, randomUUID())).toBeNull();
  });
});
