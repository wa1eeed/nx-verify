import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withoutTenant } from '../../packages/db/src/client.js';
import { applyProductSeed } from '../../packages/db/src/seed/products.js';
import { applyCostSeed } from '../../packages/db/src/seed/costs.js';
import { applyPackageSeed } from '../../packages/db/src/seed/packages.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';

/**
 * Guard 10: nothing we ship sells for less than it costs us.
 *
 * A price list and a cost list are two files that nobody reads side by side. The way that
 * ends is a composite product quietly making five provider calls while it is sold at the
 * price of one, which is not a mistake anybody notices until a quarter closes.
 *
 * The check is per call and not per product, because that is how the provider bills. A
 * product making five calls costs five calls. This is also why the national address is a
 * separate endpoint: it is a different call at a fifth of the price, and an endpoint that
 * stood for both could be costed as neither.
 *
 * Adding a product means adding its price, and the guard will say so.
 */

/** What we keep of every riyal sold, at the least, on the shipped price list. */
const MINIMUM_MARGIN = 0.3;

interface Row {
  package_code: string;
  product_code: string;
  price: string;
  cost: string;
  calls: string;
}

describe('guard 10: a shipped price covers its shipped cost', () => {
  let db: TestDatabase;
  let rows: Row[];

  beforeAll(async () => {
    db = await createTestDatabase();
    // The catalogue exactly as a deployment receives it, pointed at the provider it is
    // sold against.
    await withoutTenant(db.appPool, async (tx) => {
      await applyProductSeed(tx, undefined, { providerName: 'lean' });
      await applyCostSeed(tx);
    });
    await applyPackageSeed(db.operatorPool);

    // Read on the application connection: the cost book is ours and carries no tenant,
    // and this guard is about the catalogue rather than about any subscriber.
    const result = await db.appPool.query<Row>(
      `SELECT pp.package_code, pp.product_code,
              (pp.unit_price_halalas / 100.0)::text AS price,
              sum(c.unit_cost)::text AS cost,
              count(*)::text AS calls
       FROM package_products pp
       JOIN product_steps s ON s.product_code = pp.product_code
       JOIN LATERAL (
         SELECT unit_cost FROM cost_book
         WHERE provider = 'lean' AND endpoint = s.endpoint AND valid_to IS NULL
         ORDER BY valid_from DESC LIMIT 1
       ) c ON true
       WHERE pp.unit_price_halalas IS NOT NULL
       GROUP BY pp.package_code, pp.product_code, pp.unit_price_halalas
       ORDER BY pp.package_code, pp.product_code`,
    );
    rows = result.rows;
  });

  afterAll(async () => {
    await db.close();
  });

  it('has a cost for every call a shipped product makes', async () => {
    const { rows: uncosted } = await db.appPool.query<{ endpoint: string }>(
      `SELECT DISTINCT s.endpoint
       FROM product_steps s
       WHERE NOT EXISTS (
         SELECT 1 FROM cost_book
         WHERE provider = 'lean' AND endpoint = s.endpoint AND valid_to IS NULL
       )`,
    );
    // A call with no cost is a call the margin check silently values at zero, which makes
    // every product containing it look more profitable than it is.
    expect(uncosted.map((row) => row.endpoint)).toEqual([]);
  });

  it('sells nothing below what it costs to deliver', () => {
    expect(rows.length).toBeGreaterThan(0);
    const underwater = rows
      .filter((row) => Number(row.price) <= Number(row.cost))
      .map((row) => `${row.package_code}/${row.product_code}: ${row.price} sold, ${row.cost} cost`);
    expect(underwater).toEqual([]);
  });

  it('keeps at least the minimum margin on every shipped price', () => {
    const thin = rows
      .filter((row) => {
        const price = Number(row.price);
        const margin = (price - Number(row.cost)) / price;
        return margin < MINIMUM_MARGIN;
      })
      .map(
        (row) =>
          `${row.package_code}/${row.product_code}: ${row.price} sold, ${row.cost} cost over ${row.calls} calls`,
      );
    expect(thin).toEqual([]);
  });
});
