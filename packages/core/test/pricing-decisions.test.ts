import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listPackagesForOperator } from '../src/billing/package-admin.js';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';
import { applyPackageSeed } from '../../db/src/seed/packages.js';
import { applyProductSeed } from '../../db/src/seed/products.js';
import { withoutTenant } from '../../../packages/db/src/client.js';

/**
 * Unit 57 acceptance: the commercial decisions, as rows rather than as a conversation.
 *
 * Two of these settle questions ADR-067 left open as plan fields, and they are asserted
 * here so that a plan edited later has to disagree on purpose rather than by accident.
 */

describe('the plans the platform ships with', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx));
    await applyPackageSeed(db.operatorPool);
  });

  afterAll(async () => {
    await db.close();
  });

  it('offers the three shapes a buyer asks to compare', async () => {
    const plans = await listPackagesForOperator(db.operatorPool);
    const models = new Set(plans.map((plan) => plan.billingModel));

    expect(models).toContain('PAYG');
    expect(models).toContain('MONTHLY');
    expect(models).toContain('ANNUAL');
  });

  it('names the platform fee on the annual plan instead of hiding it in the unit price', async () => {
    const plans = await listPackagesForOperator(db.operatorPool);
    const annual = plans.find((plan) => plan.code === 'GROWTH');
    const payg = plans.find((plan) => plan.code === 'PAYG');

    // A buyer can see what the platform costs and what a verification costs, and argue
    // with each separately.
    expect(annual?.platformFeeHalalas).toBe(12_000_00);
    // Pay as you go commits to nothing, so there is nothing to charge a platform fee for.
    expect(payg?.platformFeeHalalas).toBe(0);
  });

  it('lets capacity expire with the term and lets credit carry', async () => {
    const plans = await listPackagesForOperator(db.operatorPool);
    const capacity = plans.filter((plan) => plan.includedTransactions !== null);
    const credit = plans.filter(
      (plan) => plan.includedTransactions === null && plan.commitmentCreditsHalalas > 0,
    );

    expect(capacity.length).toBeGreaterThan(0);
    expect(credit.length).toBeGreaterThan(0);

    // Three thousand verifications bought for a year are a year's worth. Money committed
    // is money, and what is unused carries as the blueprint promises.
    const { rows } = await db.operatorPool.query<{ code: string; days: number }>(
      `SELECT code, credit_rollover_days AS days FROM packages`,
    );
    const daysOf = new Map(rows.map((row) => [row.code, row.days]));
    for (const plan of capacity) {
      expect(daysOf.get(plan.code)).toBe(0);
    }
    for (const plan of credit) {
      expect(daysOf.get(plan.code)).toBe(90);
    }
  });

  it('prices each service for what it is rather than blending them', async () => {
    const plans = await listPackagesForOperator(db.operatorPool);
    const annual = plans.find((plan) => plan.code === 'GROWTH');
    const priceOf = new Map(
      (annual?.products ?? []).map((product) => [product.productCode, product.unitPriceHalalas]),
    );

    // An address check is not a company file, and one blended figure would either
    // overcharge the cheap call or undercharge the expensive one.
    expect(priceOf.get('ADDRESS_ONLY')).toBe(4_00);
    expect(priceOf.get('KYB_COMPLETE')).toBe(18_00);
    expect(priceOf.get('FREELANCER_CERTIFICATE')).toBe(20_00);
  });

  it('charges more per call where nothing was committed', async () => {
    const plans = await listPackagesForOperator(db.operatorPool);
    const payg = plans.find((plan) => plan.code === 'PAYG');
    const annual = plans.find((plan) => plan.code === 'GROWTH');

    const paygPrice = payg?.products.find((p) => p.productCode === 'KYB_COMPLETE')?.unitPriceHalalas;
    const annualPrice = annual?.products.find((p) => p.productCode === 'KYB_COMPLETE')
      ?.unitPriceHalalas;

    // The ladder only makes sense in one direction, and a plan edited to break it should
    // have to break this test on purpose.
    expect(paygPrice ?? 0).toBeGreaterThan(annualPrice ?? 0);
  });
});
