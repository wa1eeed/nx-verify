import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { canSpend, isLowOnCredit, operationsLeft, spendCapacity } from '../src/billing/capacity.js';
import { topUp } from '../src/billing/wallet.js';
import { createTestDatabase, seedTenant, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * How much a workspace can actually spend (ADR-162).
 *
 * The rule «are they low on credit» was written five separate times and every copy read the
 * wallet alone, so a subscriber holding thousands of prepaid operations was told on five
 * screens that they were out of money and hard refused from a batch they could pay for twice
 * over. These pin the one predicate all five now ask.
 */

const EMPTY = {
  planLeft: null,
  bundleOperations: 0,
  operationsBought: 0,
  walletAvailableHalalas: 0,
  walletIsLow: false,
};

describe('what a workspace can spend', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('counts a workspace with operations and an empty wallet as able to spend', () => {
    // The report that started this: a thousand operations bought and confirmed, and every
    // screen reading the wallet said zero.
    const capacity = { ...EMPTY, bundleOperations: 1000, operationsBought: 1000 };
    expect(canSpend(capacity)).toBe(true);
    expect(isLowOnCredit(capacity)).toBe(false);
    expect(operationsLeft(capacity)).toBe(1000);
  });

  it('counts a plan and its bundles as one pool, because a run takes from either', () => {
    expect(operationsLeft({ ...EMPTY, planLeft: 40, bundleOperations: 60 })).toBe(100);
  });

  it('falls back to the wallet only when there are no operations at all', () => {
    expect(operationsLeft(EMPTY)).toBeNull();
    expect(isLowOnCredit({ ...EMPTY, walletIsLow: true })).toBe(true);
    // And a wallet that is low does not make a workspace low while operations remain: those
    // are what the next verification comes out of, and they cost no riyals.
    expect(
      isLowOnCredit({ ...EMPTY, bundleOperations: 900, operationsBought: 1000, walletIsLow: true }),
    ).toBe(false);
  });

  it('calls a workspace low at a fifth of the operations it bought', () => {
    // The same figure the subscribers board has used since it was built, which is why it is
    // defined here now rather than in two places that happened to agree.
    expect(isLowOnCredit({ ...EMPTY, bundleOperations: 200, operationsBought: 1000 })).toBe(true);
    expect(isLowOnCredit({ ...EMPTY, bundleOperations: 201, operationsBought: 1000 })).toBe(false);
  });

  it('reads all three from the database in one query', async () => {
    const tenant = await seedTenant(db.appPool, 'شركة السعة');
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      spendCapacity(tx, tx.tenantId),
    );
    expect(canSpend(before)).toBe(false);
    expect(operationsLeft(before)).toBeNull();

    await withTenant(db.appPool, tenant.tenantId, (tx) => topUp(tx, { amount: 500_00 }));
    const after = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      spendCapacity(tx, tx.tenantId),
    );
    expect(after.walletAvailableHalalas).toBe(500_00);
    expect(canSpend(after)).toBe(true);
  });

  it('sees bundle operations a transfer granted', async () => {
    const tenant = await seedTenant(db.appPool, 'شركة الحزم');
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(
        `INSERT INTO bundle_grants (tenant_id, bundle_code, operations, price_halalas,
                                    expires_at, granted_by)
         SELECT $1, code, 1000, 100000, now() + interval '365 days', 'test'
           FROM credit_bundles LIMIT 1`,
        [tx.tenantId],
      ),
    );

    const capacity = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      spendCapacity(tx, tx.tenantId),
    );
    expect(capacity.bundleOperations).toBe(1000);
    expect(canSpend(capacity)).toBe(true);
    // The whole point: an empty wallet and a thousand operations is not «no balance».
    expect(capacity.walletAvailableHalalas).toBe(0);
    expect(isLowOnCredit(capacity)).toBe(false);
  });

  it('ignores a bundle that has lapsed', async () => {
    const tenant = await seedTenant(db.appPool, 'شركة حزمة منتهية');
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(
        `INSERT INTO bundle_grants (tenant_id, bundle_code, operations, price_halalas,
                                    granted_at, expires_at, granted_by)
         SELECT $1, code, 1000, 100000, now() - interval '400 days',
                now() - interval '1 day', 'test'
           FROM credit_bundles LIMIT 1`,
        [tx.tenantId],
      ),
    );
    const capacity = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      spendCapacity(tx, tx.tenantId),
    );
    expect(capacity.bundleOperations).toBe(0);
    expect(canSpend(capacity)).toBe(false);
  });
});
