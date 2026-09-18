import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withoutTenant } from '../../../packages/db/src/client.js';
import { applyProductSeed } from '../../../packages/db/src/seed/products.js';
import { applyPackageSeed } from '../../../packages/db/src/seed/packages.js';
import { applyCostSeed } from '../../../packages/db/src/seed/costs.js';
import { setPackageProduct, setTenantOverride } from '../src/billing/package-admin.js';
import { createTestDatabase, seedTenant, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * Editing a plan, and editing one subscriber's exception (ADR-164).
 *
 * Both writes replaced the whole row, and both screens post only the field they are about. So
 * toggling a module erased the plan's monthly quota and its negotiated price, and writing a
 * module exception for one subscriber erased that subscriber's special price from a screen
 * that never mentions prices. These pin the patch semantics that replaced it.
 */

const PLAN = 'GROWTH';
const PRODUCT = 'CR_FULL';

describe('editing a plan', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx, undefined, {}));
    await applyPackageSeed(db.operatorPool);
    await withoutTenant(db.appPool, (tx) => applyCostSeed(tx));
    await db.operatorPool.query(
      `INSERT INTO package_products (package_code, product_code, enabled, monthly_quota,
                                     unit_price_halalas)
       VALUES ($1, $2, true, 200, 40000)
       ON CONFLICT (package_code, product_code) DO UPDATE SET
         monthly_quota = 200, unit_price_halalas = 40000, enabled = true`,
      [PLAN, PRODUCT],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  const row = async () => {
    const { rows } = await db.operatorPool.query<{
      enabled: boolean;
      monthly_quota: number | null;
      unit_price_halalas: string | null;
    }>(
      `SELECT enabled, monthly_quota, unit_price_halalas
         FROM package_products WHERE package_code = $1 AND product_code = $2`,
      [PLAN, PRODUCT],
    );
    return rows[0];
  };

  it('keeps the quota and the price when a module is only toggled', async () => {
    // The toggle form carries neither field, and used to blank both.
    await setPackageProduct(
      db.operatorPool,
      { packageCode: PLAN, productCode: PRODUCT, enabled: false },
      'op-1',
    );
    const after = await row();
    expect(after?.enabled).toBe(false);
    expect(after?.monthly_quota).toBe(200);
    expect(Number(after?.unit_price_halalas)).toBe(40000);
  });

  it('clears a field only when the caller says null', async () => {
    await setPackageProduct(
      db.operatorPool,
      { packageCode: PLAN, productCode: PRODUCT, enabled: true, monthlyQuota: null },
      'op-1',
    );
    const after = await row();
    expect(after?.monthly_quota).toBeNull();
    // And the price it did not mention is still there.
    expect(Number(after?.unit_price_halalas)).toBe(40000);
  });

  it('refuses a plan price under what the check costs us', async () => {
    // Guard 10 applies to every price a subscriber can actually be charged, and this was the
    // one write that never checked.
    await expect(
      setPackageProduct(
        db.operatorPool,
        { packageCode: PLAN, productCode: PRODUCT, enabled: true, unitPriceHalalas: 1 },
        'op-1',
      ),
    ).rejects.toMatchObject({ code: 'NX-4002' });
  });
});

describe("a subscriber's exception", () => {
  let db: TestDatabase;
  let tenantId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx, undefined, {}));
    await applyPackageSeed(db.operatorPool);
    const tenant = await seedTenant(db.appPool, 'شركة الاستثناءات');
    tenantId = tenant.tenantId;
  });

  afterAll(async () => {
    await db.close();
  });

  const override = async () => {
    const { rows } = await db.operatorPool.query<{
      enabled: boolean | null;
      unit_price_halalas: string | null;
    }>(
      `SELECT enabled, unit_price_halalas FROM tenant_product_overrides
        WHERE tenant_id = $1 AND product_code = $2`,
      [tenantId, PRODUCT],
    );
    return rows[0];
  };

  it('does not erase a special price when a module exception is written', async () => {
    await setTenantOverride(
      db.operatorPool,
      { tenantId, productCode: PRODUCT, unitPriceHalalas: 25000 },
      'op-1',
    );
    expect(Number((await override())?.unit_price_halalas)).toBe(25000);

    // The plans screen writes only `enabled`, from a screen that never mentions prices.
    await setTenantOverride(db.operatorPool, { tenantId, productCode: PRODUCT, enabled: false }, 'op-1');
    const after = await override();
    expect(after?.enabled).toBe(false);
    expect(Number(after?.unit_price_halalas)).toBe(25000);
  });

  it('lifts the module exception without touching the price', async () => {
    await setTenantOverride(db.operatorPool, { tenantId, productCode: PRODUCT, enabled: null }, 'op-1');
    const after = await override();
    expect(after?.enabled).toBeNull();
    expect(Number(after?.unit_price_halalas)).toBe(25000);
  });

  it('removes the row once nothing on it says anything', async () => {
    await setTenantOverride(
      db.operatorPool,
      { tenantId, productCode: PRODUCT, enabled: null, monthlyQuota: null, unitPriceHalalas: null },
      'op-1',
    );
    expect(await override()).toBeUndefined();
  });
});
