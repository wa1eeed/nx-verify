import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import { requestBundle } from '../src/billing/bundles.js';
import { confirmTopUp } from '../src/billing/topups.js';
import { listEntitlements } from '../src/billing/entitlements.js';
import { setTenantDiscount } from '../src/billing/pricing-admin.js';
import { listOperatorAudit } from '../src/operators/audit.js';
import type { OperatorIdentity } from '../src/operators/accounts.js';
import {
  assignSubscriberPlan,
  createSubscriber,
  setSubscriberSuspended,
  standingOf,
  subscribersBoard,
} from '../src/billing/subscribers-board.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * Handoff phase 8: the subscribers and their balances of screen 06, on real Postgres.
 *
 * Every figure is read on the operator connection from commercial rows and monthly counters,
 * so a query that needed a subscriber's runs or attestations would fail here with a permission
 * error rather than pass quietly.
 */

const OWNER: OperatorIdentity = { id: 'nx-staff:test-owner', displayName: 'مالك', role: 'OWNER' };
const SUPPORT: OperatorIdentity = {
  id: 'nx-staff:test-support',
  displayName: 'دعم',
  role: 'SUPPORT',
};
const PRICING: OperatorIdentity = {
  id: 'nx-staff:test-pricing',
  displayName: 'تسعير',
  role: 'PRICING',
};

describe('the standing of a subscriber', () => {
  const base = {
    status: 'active',
    billingModel: 'MONTHLY',
    daysLeft: 200,
    operationsLeft: 900,
    operationsBought: 1000,
    lowBalance: false,
  };

  it('is suspended when stopped, cancelled, without a plan, or past its term', () => {
    expect(standingOf({ ...base, status: 'suspended' })).toBe('SUSPENDED');
    expect(standingOf({ ...base, status: 'cancelled' })).toBe('SUSPENDED');
    expect(standingOf({ ...base, status: null })).toBe('SUSPENDED');
    expect(standingOf({ ...base, daysLeft: -1 })).toBe('SUSPENDED');
  });

  it('is ending soon within fourteen days, and a plan paid per operation never ends', () => {
    expect(standingOf({ ...base, daysLeft: 14 })).toBe('EXPIRING');
    expect(standingOf({ ...base, daysLeft: 15 })).toBe('ACTIVE');
    expect(standingOf({ ...base, billingModel: 'PAYG', daysLeft: -30 })).toBe('ACTIVE');
  });

  it('is low at a fifth of the operations bought, or by the wallet rule without operations', () => {
    expect(standingOf({ ...base, operationsLeft: 200 })).toBe('LOW_BALANCE');
    expect(standingOf({ ...base, operationsLeft: 201 })).toBe('ACTIVE');
    expect(
      standingOf({ ...base, operationsLeft: null, operationsBought: 0, lowBalance: true }),
    ).toBe('LOW_BALANCE');
  });
});

describe('the subscribers board, as the operator sees it', () => {
  let db: TestDatabase;
  let healthy: SeededTenant;
  let low: SeededTenant;
  let ending: SeededTenant;
  let lapsed: SeededTenant;
  let bundled: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  const inTenant = <T>(
    tenantId: string,
    handler: Parameters<typeof withTenant<T>>[2],
  ): Promise<T> => withTenant(db.appPool, tenantId, handler);

  beforeAll(async () => {
    db = await createTestDatabase();
    healthy = await seedTenant(db.appPool, 'Healthy Co');
    low = await seedTenant(db.appPool, 'Low Co');
    ending = await seedTenant(db.appPool, 'Ending Co');
    lapsed = await seedTenant(db.appPool, 'Lapsed Co');
    bundled = await seedTenant(db.appPool, 'Bundled Co');
    for (const tenant of [healthy, low, ending, lapsed]) {
      await preparePricedTenant(db, tenant.tenantId, {
        packageCode: 'ESSENTIAL',
        balanceHalalas: 900_00,
      });
    }
    await preparePricedTenant(db, bundled.tenantId, { packageCode: 'PAYG' });

    const set = (tenantId: string, sql: string): Promise<unknown> =>
      db.operatorPool.query(`UPDATE tenant_commitments SET ${sql} WHERE tenant_id = $1`, [
        tenantId,
      ]);
    await set(healthy.tenantId, `term_end = now() + interval '200 days'`);
    await set(low.tenantId, `term_end = now() + interval '200 days', transactions_used = 2900`);
    await set(ending.tenantId, `term_end = now() + interval '5 days 1 hour'`);
    await set(
      lapsed.tenantId,
      `term_start = now() - interval '100 days', term_end = now() - interval '3 days'`,
    );

    // A run this month, counted for the healthy subscriber.
    await withTenant(db.appPool, healthy.tenantId, (tx) =>
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

    // A bundle bought and confirmed, and a discount, for the subscriber who pays by bundles.
    const request = await withTenant(db.appPool, bundled.tenantId, (tx) =>
      requestBundle(tx, { bundleCode: 'BUNDLE_500' }),
    );
    await withTenant(db.appPool, bundled.tenantId, (tx) =>
      confirmTopUp(tx, { requestId: request.id, vatInvoiceId: 'INV-B-1', settledBy: OWNER.id }),
    );
    await setTenantDiscount(db.operatorPool, OWNER, {
      tenantId: bundled.tenantId,
      discountPct: 5,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('says where each subscriber stands', async () => {
    const board = await subscribersBoard(db.operatorPool);
    const standing = (tenant: SeededTenant) =>
      board.rows.find((row) => row.tenantId === tenant.tenantId)?.standing;

    expect(standing(healthy)).toBe('ACTIVE');
    expect(standing(low)).toBe('LOW_BALANCE');
    expect(standing(ending)).toBe('EXPIRING');
    expect(standing(lapsed)).toBe('SUSPENDED');
    expect(standing(bundled)).toBe('ACTIVE');
  });

  it('counts package and bundle operations, thirty days of use, and a special price', async () => {
    const board = await subscribersBoard(db.operatorPool);
    const row = (tenant: SeededTenant) =>
      board.rows.find((entry) => entry.tenantId === tenant.tenantId);

    expect(row(low)?.operationsLeft).toBe(100);
    expect(row(bundled)?.operationsLeft).toBe(500);
    expect(row(bundled)?.largestBundle).toBe(500);
    expect(row(bundled)?.hasSpecialPrice).toBe(true);
    expect(row(healthy)?.hasSpecialPrice).toBe(false);
    expect(row(healthy)?.runs30).toBeGreaterThanOrEqual(1);
  });

  it('sums the figures above the table from the same rows', async () => {
    const board = await subscribersBoard(db.operatorPool);

    expect(board.active).toBe(board.rows.filter((row) => row.standing !== 'SUSPENDED').length);
    expect(board.expiringSoon).toBeGreaterThanOrEqual(1);
    expect(board.needsAction).toBe(board.rows.filter((row) => row.standing !== 'ACTIVE').length);
    // The lapsed subscriber's operations are not counted as a balance anybody can spend.
    const spendable = board.rows
      .filter((row) => row.standing !== 'SUSPENDED')
      .reduce((total, row) => total + (row.operationsLeft ?? 0), 0);
    expect(board.unconsumedOperations).toBe(spendable);
    expect(board.runsThisMonth).toBeGreaterThanOrEqual(1);
    // The bundle sold this month is revenue this month, before VAT.
    expect(board.revenue.thisMonthHalalas).toBeGreaterThanOrEqual(10_000_00);
    expect(board.revenue.lastMonthHalalas).toBe(0);
    expect(board.revenue.changePct).toBeNull();
  });

  it('makes a subscriber with its administrator and its plan, once per workspace name', async () => {
    const made = await createSubscriber(inTenant, db.operatorPool, SUPPORT, {
      legalName: 'شركة الأفق الجديدة',
      slug: 'ofuq-new',
      adminEmail: 'Admin@Ofuq.example.sa',
      packageCode: 'ESSENTIAL',
    });

    expect(made.slug).toBe('ofuq-new');
    expect(made.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    const board = await subscribersBoard(db.operatorPool);
    const row = board.rows.find((entry) => entry.tenantId === made.tenantId);
    expect(row?.packageCode).toBe('ESSENTIAL');
    expect(row?.legalName).toBe('شركة الأفق الجديدة');

    const credentials = await withTenant(db.appPool, made.tenantId, (tx) =>
      tx.query<{ email: string; must_change: boolean }>(
        `SELECT u.email, c.must_change FROM users u
         JOIN user_credentials c ON c.tenant_id = u.tenant_id AND c.user_id = u.id`,
      ),
    );
    expect(credentials.rows).toEqual([{ email: 'admin@ofuq.example.sa', must_change: true }]);

    await expect(
      createSubscriber(inTenant, db.operatorPool, SUPPORT, {
        legalName: 'نسخة',
        slug: 'ofuq-new',
        adminEmail: 'other@ofuq.example.sa',
        packageCode: 'ESSENTIAL',
      }),
    ).rejects.toMatchObject({ code: 'NX-4091' });
    await expect(
      createSubscriber(inTenant, db.operatorPool, PRICING, {
        legalName: 'مرفوض',
        slug: 'refused-co',
        adminEmail: 'a@refused.example.sa',
        packageCode: 'ESSENTIAL',
      }),
    ).rejects.toMatchObject({ code: 'NX-4031' });
    await expect(
      createSubscriber(inTenant, db.operatorPool, SUPPORT, {
        legalName: 'اسم',
        slug: 'Bad Slug',
        adminEmail: 'a@bad.example.sa',
        packageCode: 'ESSENTIAL',
      }),
    ).rejects.toMatchObject({ code: 'NX-4002' });
  });

  it('suspends a subscriber so no run is allowed, and lets it run again', async () => {
    await setSubscriberSuspended(db.operatorPool, SUPPORT, healthy.tenantId, true);

    let board = await subscribersBoard(db.operatorPool);
    expect(board.rows.find((row) => row.tenantId === healthy.tenantId)?.standing).toBe('SUSPENDED');
    const refused = await withTenant(db.appPool, healthy.tenantId, (tx) => listEntitlements(tx));
    expect(refused.every((entry) => !entry.allowed)).toBe(true);
    expect(refused.some((entry) => entry.refusal === 'SUBSCRIPTION_INACTIVE')).toBe(true);

    await setSubscriberSuspended(db.operatorPool, SUPPORT, healthy.tenantId, false);
    board = await subscribersBoard(db.operatorPool);
    expect(board.rows.find((row) => row.tenantId === healthy.tenantId)?.standing).toBe('ACTIVE');

    const trail = await listOperatorAudit(db.operatorPool, {
      targetPrefixes: [`subscriber:${healthy.tenantId}`],
    });
    expect(trail.map((row) => row.action)).toEqual([
      'subscribers.resumed',
      'subscribers.suspended',
    ]);
  });

  it('moves a subscriber to another plan, and refuses a role that may not', async () => {
    await assignSubscriberPlan(db.operatorPool, OWNER, low.tenantId, 'ENTERPRISE');
    const board = await subscribersBoard(db.operatorPool);
    expect(board.rows.find((row) => row.tenantId === low.tenantId)?.packageCode).toBe('ENTERPRISE');
    await expect(
      setSubscriberSuspended(db.operatorPool, PRICING, low.tenantId, true),
    ).rejects.toMatchObject({ code: 'NX-4031' });
  });
});
