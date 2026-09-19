import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withoutTenant } from '../../../packages/db/src/client.js';
import { applyProductSeed } from '../../../packages/db/src/seed/products.js';
import { applyPackageSeed } from '../../../packages/db/src/seed/packages.js';
import { applyCostSeed } from '../../../packages/db/src/seed/costs.js';
import { applyDefaultPriceSeed } from '../../../packages/db/src/seed/default-prices.js';
import { listOperatorAudit } from '../src/operators/audit.js';
import type { OperatorIdentity } from '../src/operators/accounts.js';
import {
  addCreditBundle,
  addPlan,
  clearListPrice,
  listCreditBundles,
  listPlans,
  listProductPricing,
  setListPrice,
  setPlanTerms,
  setProductOnSale,
} from '../src/billing/pricing-admin.js';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * The figures of the pricing screen that decided money and appeared nowhere.
 *
 * Four of them: the share a NOT_FOUND and a CACHED answer are charged at, the terms a plan
 * carries beside its price, the price of one operation in a bundle, and the ability to take
 * a price off a check at all. Each was written by the code as a literal or copied forward
 * blindly, and the screen that is supposed to be the place these are decided showed none.
 */

const owner: OperatorIdentity = { id: 'op-owner', displayName: 'وليد الغامدي', role: 'OWNER' };

describe('the prices of the panel', () => {
  let db: TestDatabase;
  const operator = () => db.operatorPool;

  beforeAll(async () => {
    db = await createTestDatabase();
    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx, undefined, { providerName: 'lean' }));
    await applyPackageSeed(db.operatorPool);
    await withoutTenant(db.appPool, (tx) => applyCostSeed(tx));
    await applyDefaultPriceSeed(db.migratorPool);
  });

  afterAll(async () => {
    await db.close();
  });

  const productRow = async (code: string) =>
    (await listProductPricing(operator())).find((row) => row.productCode === code);

  it('reads back what a not found and a cached answer are charged', async () => {
    const row = await productRow('CR_FULL');
    // The defaults of migration 0011, which is where these have lived unseen: half price for
    // an authority that answered «no such subject», full price for an answer from cache.
    expect(row?.rates).toEqual({ negativePct: 0.5, cachePct: 1 });
    expect(row?.stepCount).toBe(1);
  });

  it('versions the price row when only a rate moves, and leaves the old one as it billed', async () => {
    const before = await productRow('CR_FULL');
    const change = await setListPrice(operator(), owner, 'CR_FULL', before?.priceHalalas ?? 0, {
      negativePct: 0.25,
    });
    expect(change?.rates).toEqual({ negativePct: 0.25, cachePct: 1 });
    expect((await productRow('CR_FULL'))?.rates).toEqual({ negativePct: 0.25, cachePct: 1 });

    // A run billed last week must stay readable at the numbers that billed it, so the old
    // row is closed and kept rather than edited.
    const { rows } = await db.migratorPool.query<{ negative_pct: string; valid_to: Date | null }>(
      `SELECT negative_pct::text, valid_to FROM price_book
        WHERE product_code = 'CR_FULL' AND tenant_id IS NULL ORDER BY valid_from`,
    );
    expect(rows.map((row) => row.negative_pct)).toEqual(['0.50', '0.25']);
    expect(rows[0]?.valid_to).not.toBeNull();

    // Saving the same figures again opens nothing: a price history is not a log of presses.
    expect(
      await setListPrice(operator(), owner, 'CR_FULL', before?.priceHalalas ?? 0, {
        negativePct: 0.25,
      }),
    ).toBeNull();
  });

  it('refuses a share that is not a share', async () => {
    const price = (await productRow('CR_FULL'))?.priceHalalas ?? 0;
    for (const rates of [{ negativePct: 1.5 }, { cachePct: -0.1 }, { negativePct: 0.125 }]) {
      await expect(setListPrice(operator(), owner, 'CR_FULL', price, rates)).rejects.toMatchObject({
        code: 'NX-4002',
      });
    }
    // And takes the percentages that binary floating point does not represent exactly: seven
    // percent is 0.07, and 0.07 times a hundred is 7.000000000000001.
    const seven = await setListPrice(operator(), owner, 'CR_FULL', price, { cachePct: 0.07 });
    expect(seven?.rates.cachePct).toBe(0.07);
    expect((await productRow('CR_FULL'))?.rates?.cachePct).toBe(0.07);
    await setListPrice(operator(), owner, 'CR_FULL', price, { cachePct: 1 });
  });

  it('keeps a price on a check that is on sale, and lets one go once it is not', async () => {
    // Clearing a price on a check still on sale leaves every run of it failing at
    // resolvePrice with NX-4041, which is the state this refusal exists to prevent.
    await expect(clearListPrice(operator(), owner, 'FREELANCE_CERTIFICATE')).rejects.toMatchObject({
      code: 'NX-4002',
    });

    await setProductOnSale(operator(), owner, 'FREELANCE_CERTIFICATE', false);
    expect(await clearListPrice(operator(), owner, 'FREELANCE_CERTIFICATE')).toBe(true);
    expect((await productRow('FREELANCE_CERTIFICATE'))?.priceHalalas).toBeNull();
    // Nothing left open to close, so nothing happens and nothing is recorded.
    expect(await clearListPrice(operator(), owner, 'FREELANCE_CERTIFICATE')).toBe(false);

    // And it cannot go back on sale until somebody prices it again.
    await expect(
      setProductOnSale(operator(), owner, 'FREELANCE_CERTIFICATE', true),
    ).rejects.toMatchObject({ code: 'NX-4002' });
    await setListPrice(operator(), owner, 'FREELANCE_CERTIFICATE', 20_00);
    await setProductOnSale(operator(), owner, 'FREELANCE_CERTIFICATE', true);
    expect((await productRow('FREELANCE_CERTIFICATE'))?.status).toBe('active');

    const trail = await listOperatorAudit(operator(), {
      targetPrefixes: ['pricing:product:FREELANCE_CERTIFICATE'],
    });
    expect(trail.map((row) => row.action)).toContain('pricing.price_cleared');
  });

  it('refuses to overwrite a bundle nobody asked to replace, and says so when they do', async () => {
    const dearest = 42_00; // KYB_COMPLETE, the dearest run the seeded catalogue sells.
    const added = await addCreditBundle(operator(), owner, {
      operations: 1000,
      priceHalalas: dearest * 1000,
    });
    expect(added.perOperationHalalas).toBe(dearest);

    // «إضافة» with a count already on the list used to overwrite that bundle silently.
    await expect(
      addCreditBundle(operator(), owner, { operations: 1000, priceHalalas: dearest * 1000 }),
    ).rejects.toMatchObject({ code: 'NX-4091' });

    // Naming the bundle it replaces is the whole of the permission.
    const replaced = await addCreditBundle(operator(), owner, {
      operations: 1000,
      priceHalalas: 50_00 * 1000,
      validityMonths: 24,
      replaces: 'BUNDLE_1000',
    });
    expect(replaced).toMatchObject({ perOperationHalalas: 50_00, validityMonths: 24 });
    await expect(
      addCreditBundle(operator(), owner, {
        operations: 7,
        priceHalalas: 50_00 * 7,
        replaces: 'BUNDLE_7',
      }),
    ).rejects.toMatchObject({ code: 'NX-4041' });

    const trail = await listOperatorAudit(operator(), {
      targetPrefixes: ['pricing:bundle:BUNDLE_1000'],
    });
    expect(trail.map((row) => row.action)).toEqual([
      'pricing.bundle_replaced',
      'pricing.bundle_added',
    ]);
  });

  it('measures every bundle against the smallest one on sale', async () => {
    const bundles = await listCreditBundles(operator());
    const smallest = bundles[0];
    expect(smallest?.discountPct).toBeNull();
    for (const bundle of bundles.slice(1)) {
      expect(bundle.perOperationHalalas).toBeGreaterThan(0);
      if (bundle.perOperationHalalas < (smallest?.perOperationHalalas ?? 0)) {
        expect(bundle.discountPct).not.toBeNull();
      }
    }
  });

  it('writes the terms a plan was given rather than the ones the code used to assume', async () => {
    const plan = await addPlan(operator(), owner, {
      code: 'TERMED',
      nameAr: 'ذات شروط',
      nameEn: 'Termed',
      monthlyFeeHalalas: 900_00,
      includedTransactions: 300,
      overageUnitHalalas: 45_00,
      termMonths: 24,
      freeReverifyDays: 0,
      setupFeeHalalas: 5_000_00,
      commitmentCreditsHalalas: 10_000_00,
      overageAllowed: false,
    });
    expect(plan).toMatchObject({
      termMonths: 24,
      freeReverifyDays: 0,
      setupFeeHalalas: 5_000_00,
      commitmentCreditsHalalas: 10_000_00,
      overageAllowed: false,
    });

    // The window that prices a repeat check at zero is a figure somebody sets, not a literal.
    const patched = await setPlanTerms(operator(), owner, 'TERMED', { freeReverifyDays: 90 });
    expect(patched.freeReverifyDays).toBe(90);
    // A patch: what it did not name it did not touch.
    expect(patched).toMatchObject({ termMonths: 24, setupFeeHalalas: 5_000_00 });
    expect((await listPlans(operator())).find((entry) => entry.code === 'TERMED')).toMatchObject({
      freeReverifyDays: 90,
      platformFeeHalalas: 900_00,
    });

    await expect(
      setPlanTerms(operator(), owner, 'TERMED', { termMonths: 18 }),
    ).rejects.toMatchObject({ code: 'NX-4002' });
    await expect(
      setPlanTerms(operator(), owner, 'TERMED', { freeReverifyDays: 400 }),
    ).rejects.toMatchObject({ code: 'NX-4002' });
    await expect(setPlanTerms(operator(), owner, 'NO_SUCH', {})).rejects.toMatchObject({
      code: 'NX-4041',
    });

    // Guard 10 for the price past the capacity: allowing overage at a price under the
    // dearest run it can pay for is selling under cost.
    await expect(
      setPlanTerms(operator(), owner, 'TERMED', { overageAllowed: true, overageUnitHalalas: 1_00 }),
    ).rejects.toMatchObject({ code: 'NX-4002' });

    const trail = await listOperatorAudit(operator(), { targetPrefixes: ['pricing:plan:TERMED'] });
    expect(trail.map((row) => row.action)).toContain('pricing.plan_terms');
    expect(trail.find((row) => row.action === 'pricing.plan_terms')?.metadata).toEqual({
      free_reverify_days: 90,
    });
  });
});
