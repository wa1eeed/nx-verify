import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { listAvailableBundles, pricePerOperation } from '../src/billing/bundles.js';
import { addCreditBundle, listCreditBundles } from '../src/billing/pricing-admin.js';
import type { OperatorIdentity } from '../src/operators/accounts.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';

/**
 * What a bundle costs per operation, and against what its discount is measured (ADR-171).
 *
 * The buyer's card showed a count of operations, a whole price and a «−8%». The price of one
 * operation, which is the figure the whole price is judged by and the figure the percent is
 * computed from, was never on the screen, and the percent was measured against whichever
 * bundle happened to be first in the list.
 */

const owner: OperatorIdentity = { id: 'op-owner', displayName: 'وليد الغامدي', role: 'OWNER' };

describe('the bundles on sale', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'شركة الحزم');
  });

  afterAll(async () => {
    await db.close();
  });

  const onSale = () => withTenant(db.appPool, tenant.tenantId, (tx) => listAvailableBundles(tx));

  it('gives every bundle the price of one operation', async () => {
    const bundles = await onSale();
    // The seeded three: 10,000 riyals for 500 operations is 20.00 a run, and the two larger
    // ones come down from there.
    expect(bundles.map((bundle) => [bundle.code, bundle.perOperationHalalas])).toEqual([
      ['BUNDLE_500', 20_00],
      ['BUNDLE_2000', 18_40],
      ['BUNDLE_10000', 17_00],
    ]);
    for (const bundle of bundles) {
      expect(bundle.perOperationHalalas).toBe(Math.round(bundle.priceHalalas / bundle.operations));
    }
  });

  it('carries the bundle every discount was measured against, or no discount at all', async () => {
    const bundles = await onSale();
    const smallest = bundles.find((bundle) => bundle.code === 'BUNDLE_500');
    expect(smallest?.discount).toBeNull();
    // A percent never travels without its basis: the type has them in one value, so a screen
    // cannot print «−8%» and leave the buyer to guess what it is eight percent of.
    expect(bundles.find((bundle) => bundle.code === 'BUNDLE_2000')?.discount).toEqual({
      pct: 8,
      againstOperations: 500,
    });
    expect(bundles.find((bundle) => bundle.code === 'BUNDLE_10000')?.discount).toEqual({
      pct: 15,
      againstOperations: 500,
    });
  });

  it('measures against the smallest bundle however the list is ordered', () => {
    // The order the card used to trust. Here the smallest bundle is last, and a bundle dearer
    // per operation than it is first.
    const priced = pricePerOperation([
      { code: 'BUNDLE_2000', operations: 2000, priceHalalas: 50_000_00, validityMonths: 12 },
      { code: 'BUNDLE_10000', operations: 10_000, priceHalalas: 170_000_00, validityMonths: 12 },
      { code: 'BUNDLE_500', operations: 500, priceHalalas: 10_000_00, validityMonths: 12 },
    ]);
    const of = (code: string) => priced.find((bundle) => bundle.code === code);
    // 25.00 an operation against the smallest bundle's 20.00: dearer, so no discount is
    // claimed rather than a negative one printed.
    expect(of('BUNDLE_2000')).toMatchObject({ perOperationHalalas: 25_00, discount: null });
    expect(of('BUNDLE_10000')).toMatchObject({
      perOperationHalalas: 17_00,
      discount: { pct: 15, againstOperations: 500 },
    });
    expect(of('BUNDLE_500')?.discount).toBeNull();
  });

  it('claims no discount it cannot show, when both prices round to the same halala', () => {
    // 150.4 halalas an operation against 149.6: half a percent apart, and the same 1.50 ر.س
    // on the card. A percent worked out before the rounding would print «أقل 1%» beside two
    // prices the buyer can see are equal.
    const priced = pricePerOperation([
      { code: 'BUNDLE_500', operations: 500, priceHalalas: 752_00, validityMonths: 12 },
      { code: 'BUNDLE_2000', operations: 2000, priceHalalas: 2_992_00, validityMonths: 12 },
    ]);
    expect(priced.map((bundle) => bundle.perOperationHalalas)).toEqual([150, 150]);
    expect(priced.map((bundle) => bundle.discount)).toEqual([null, null]);
  });

  it('claims nothing for a single bundle, and nothing for none', () => {
    expect(
      pricePerOperation([
        { code: 'BUNDLE_500', operations: 500, priceHalalas: 10_000_00, validityMonths: 12 },
      ])[0],
    ).toMatchObject({ perOperationHalalas: 20_00, discount: null });
    expect(pricePerOperation([])).toEqual([]);
  });

  it('keeps a bundle whose count is already taken rather than overwriting it', async () => {
    const before = await addCreditBundle(db.operatorPool, owner, {
      operations: 750,
      priceHalalas: 15_000_00,
      validityMonths: 12,
    });
    expect(before.perOperationHalalas).toBe(20_00);

    // «إضافة» with a count already on the list is not an addition. It is refused by name, and
    // the bundle on sale is untouched: the price subscribers are looking at right now does
    // not move because somebody typed the same count into an add dialog.
    await expect(
      addCreditBundle(db.operatorPool, owner, {
        operations: 750,
        priceHalalas: 30_000_00,
        validityMonths: 24,
      }),
    ).rejects.toMatchObject({ code: 'NX-4091' });
    expect(
      (await listCreditBundles(db.operatorPool)).find((bundle) => bundle.code === 'BUNDLE_750'),
    ).toMatchObject({ priceHalalas: 15_000_00, validityMonths: 12 });

    // Naming it is the whole of the permission, and then the new price is what is on sale.
    await addCreditBundle(db.operatorPool, owner, {
      operations: 750,
      priceHalalas: 30_000_00,
      validityMonths: 24,
      replaces: 'BUNDLE_750',
    });
    const replaced = (await onSale()).find((bundle) => bundle.code === 'BUNDLE_750');
    expect(replaced).toMatchObject({ perOperationHalalas: 40_00, validityMonths: 24 });
  });

  it('refuses the second of two operators adding the same count at the same moment', async () => {
    // The refusal is claimed to live in the write itself rather than in a read a moment
    // earlier, so it is worth proving on a real connection: the read each operator makes sees
    // no bundle of this count, because the other one has not committed yet.
    const first = await db.operatorPool.connect();
    const second = await db.operatorPool.connect();
    const watcher = await db.operatorPool.connect();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await addCreditBundle(first, owner, {
        operations: 900,
        priceHalalas: 18_000_00,
        validityMonths: 12,
      });

      // The second operator runs while the first is still uncommitted, so its own read finds
      // no bundle of this count and every guard before the write lets it through. It reaches
      // the INSERT and waits there on the unique index.
      // Settled into a value rather than left to reject on its own: the rejection arrives
      // while the test is still waiting on the commit, and an unhandled one fails the run.
      const secondAdd = addCreditBundle(second, owner, {
        operations: 900,
        priceHalalas: 36_000_00,
        validityMonths: 24,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const { rows } = await watcher.query<{ waiting: number }>(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        blocked = (rows[0]?.waiting ?? 0) > 0;
      }
      // Without this the commit could land before the second transaction had read anything,
      // and the refusal would be the old one from the read rather than the one in the write.
      expect(blocked).toBe(true);

      await first.query('COMMIT');
      await expect(secondAdd).resolves.toMatchObject({ code: 'NX-4091' });
      await second.query('ROLLBACK');
    } finally {
      first.release();
      second.release();
      watcher.release();
    }

    // One addition, at the price the operator who got there first typed.
    expect(
      (await listCreditBundles(db.operatorPool)).find((bundle) => bundle.code === 'BUNDLE_900'),
    ).toMatchObject({ priceHalalas: 18_000_00, validityMonths: 12 });
  });
});
