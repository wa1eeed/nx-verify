import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { applyProductSeed } from '../../../packages/db/src/seed/products.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { checkMargin, openPriceVersion, resolvePrice } from '../src/billing/price-book.js';
import { getLedger, getWallet, reconcile, topUp, vatForTopUp } from '../src/billing/wallet.js';
import { halalasToDecimalString, riyalsToHalalas, vatOn } from '../src/billing/money.js';

describe('money is integer halalas', () => {
  it('does not accumulate floating point error', () => {
    const tenth = riyalsToHalalas(0.1);
    const fifth = riyalsToHalalas(0.2);
    expect(tenth + fifth).toBe(riyalsToHalalas(0.3));
  });

  it('formats for a numeric(12,2) column', () => {
    expect(halalasToDecimalString(4400)).toBe('44.00');
    expect(halalasToDecimalString(5)).toBe('0.05');
    expect(halalasToDecimalString(-2860)).toBe('-28.60');
  });

  it('computes VAT at fifteen percent', () => {
    expect(vatOn(100_00)).toBe(15_00);
  });
});

describe('pricing and the wallet', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Billing Tenant');
    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx));
  });

  afterAll(async () => {
    await db.close();
  });

  it('opens a price version and closes the one it replaces', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await openPriceVersion(tx, { productCode: 'ADDRESS_ONLY', unitPriceHalalas: 8_00 });
      const first = await resolvePrice(tx, 'ADDRESS_ONLY');
      expect(first.unitPrice).toBe(8_00);
      expect(first.version).toBe(1);

      await openPriceVersion(tx, { productCode: 'ADDRESS_ONLY', unitPriceHalalas: 9_00 });
      const second = await resolvePrice(tx, 'ADDRESS_ONLY');
      expect(second.unitPrice).toBe(9_00);
      expect(second.version).toBe(2);
      expect(second.id).not.toBe(first.id);
    });
  });

  it('refuses to edit a price in place', async () => {
    const priceId = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const price = await resolvePrice(tx, 'ADDRESS_ONLY');
      return price.id;
    });

    // Changing a price must open a version, never rewrite one, or a past run could be
    // re-priced and an issued invoice would stop reconciling.
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query('UPDATE price_book SET unit_price = 1.00 WHERE id = $1', [priceId]),
      ),
    ).rejects.toMatchObject({ code: 'NX003' });
  });

  it('prefers the tenant price over the default list', async () => {
    // Published by the operator, not by a tenant. The application role has no path to a
    // row that belongs to no tenant.
    await db.migratorPool.query(
      `INSERT INTO price_book (tenant_id, product_code, unit_price, version)
       VALUES (NULL, 'IBAN_OWNERSHIP', 20.00, 1)`,
    );

    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const listPrice = await resolvePrice(tx, 'IBAN_OWNERSHIP');
      expect(listPrice.unitPrice).toBe(20_00);
      expect(listPrice.tenantId).toBeNull();

      await openPriceVersion(tx, { productCode: 'IBAN_OWNERSHIP', unitPriceHalalas: 12_00 });
      const negotiated = await resolvePrice(tx, 'IBAN_OWNERSHIP');
      expect(negotiated.unitPrice).toBe(12_00);
      expect(negotiated.tenantId).toBe(tenant.tenantId);
    });
  });

  it('checks the margin against the sum of provider costs', async () => {
    await withoutTenant(db.appPool, (tx) =>
      tx.query(
        `INSERT INTO cost_book (provider, endpoint, unit_cost)
         VALUES ('stub', 'business_verification', 3.00)
         ON CONFLICT DO NOTHING`,
      ),
    );

    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const healthy = await checkMargin(tx, 'ADDRESS_ONLY', 9_00);
      expect(healthy.totalCost).toBe(3_00);
      expect(healthy.meetsMinimum).toBe(true);

      const thin = await checkMargin(tx, 'ADDRESS_ONLY', 3_50);
      expect(thin.meetsMinimum).toBe(false);
    });
  });

  it('puts VAT on the top up and never on consumption', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await topUp(tx, { amount: 500_00, vatInvoiceId: 'INV-2026-1' });
      const ledger = await getLedger(tx);
      const topUpRow = ledger.find((entry) => entry.reason === 'TOPUP');
      expect(topUpRow?.vatInvoiceId).toBe('INV-2026-1');
      expect(vatForTopUp(500_00)).toBe(75_00);
    });
  });

  it('refuses a tax invoice on anything but a top up', async () => {
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query(
          `INSERT INTO wallet_ledger (tenant_id, delta, balance_after, reason, vat_invoice_id)
           VALUES ($1, -5.00, 100.00, 'CHARGE', 'INV-2026-2')`,
          [tenant.tenantId],
        ),
      ),
      // A second tax invoice when the balance is spent would be a real compliance error.
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps the ledger append only, at both layers', async () => {
    const entryId = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const ledger = await getLedger(tx);
      return ledger[0]?.id;
    });

    // Layer 1: the application role holds neither UPDATE nor DELETE on the ledger.
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query('UPDATE wallet_ledger SET delta = 0 WHERE id = $1', [entryId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    // Layer 2: the trigger refuses even the owner, which does hold them.
    await expect(
      withTenant(db.migratorPool, tenant.tenantId, (tx) =>
        tx.query('UPDATE wallet_ledger SET delta = 0 WHERE id = $1', [entryId]),
      ),
    ).rejects.toMatchObject({ code: 'NX004' });

    await expect(
      withTenant(db.migratorPool, tenant.tenantId, (tx) =>
        tx.query('DELETE FROM wallet_ledger WHERE id = $1', [entryId]),
      ),
    ).rejects.toMatchObject({ code: 'NX004' });
  });

  it('reconciles the ledger against the wallet', async () => {
    const result = await withTenant(db.appPool, tenant.tenantId, (tx) => reconcile(tx));
    expect(result.matches).toBe(true);
  });

  it('refuses to start a run it cannot cover', async () => {
    const poor = await seedTenant(db.appPool, 'Poor Tenant');
    await withTenant(db.appPool, poor.tenantId, async (tx) => {
      await topUp(tx, { amount: 1_00, vatInvoiceId: 'INV-SMALL' });
      const { hold } = await import('../src/billing/wallet.js');
      await expect(hold(tx, 44_00)).rejects.toMatchObject({ code: 'NX-4002' });
      const wallet = await getWallet(tx);
      expect(wallet.held).toBe(0);
    });
  });

  it('keeps one tenant balance invisible to another', async () => {
    const other = await seedTenant(db.appPool, 'Billing Other Tenant');
    await expect(
      withTenant(db.appPool, other.tenantId, (tx) => getWallet(tx)),
    ).rejects.toMatchObject({ code: 'NX-4041' });
  });
});
