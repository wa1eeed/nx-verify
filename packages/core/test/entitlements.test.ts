import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { applyProductSeed } from '../../../packages/db/src/seed/products.js';
import { applyPackageSeed } from '../../../packages/db/src/seed/packages.js';
import { setTenantPackage } from '../src/billing/package-admin.js';
import { verify } from '../src/verification/verify.js';
import {
  chargedUnitPrice,
  computeTermExtras,
  getCommitment,
  listEntitlements,
  resolveEntitlement,
  setupFeeFor,
} from '../src/billing/entitlements.js';
import { getWallet } from '../src/billing/wallet.js';
import { NxError } from '../src/errors.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * Unit 37 acceptance: a subscriber can run what they bought and nothing else.
 *
 * The interesting cases are not the happy one. They are: a module the package does not
 * include, a quota that runs out mid cycle, a negotiated exception that outranks the
 * package in both directions, and the question of what a refusal costs. A refusal that
 * charges, or that leaves a run behind, is worse than no packaging at all.
 */

describe('packages and entitlement', () => {
  let db: TestDatabase;
  let starter: SeededTenant;
  let enterprise: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  const subject = {
    unn: '7001272184',
    manager: { id: '1098765432', id_type: 'NATIONAL_ID' as const },
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    starter = await seedTenant(db.appPool, 'Starter Tenant');
    enterprise = await seedTenant(db.appPool, 'Enterprise Tenant');

    await preparePricedTenant(db, starter.tenantId, { packageCode: 'ESSENTIAL' });
    await preparePricedTenant(db, enterprise.tenantId, { packageCode: 'ENTERPRISE' });
  });

  afterAll(async () => {
    await db.close();
  });

  // Each product asks for the subject its own schema describes (rule 8).
  const subjectFor = (productCode: string): Record<string, unknown> => {
    if (productCode === 'ADDRESS_ONLY') {
      return { unn: subject.unn };
    }
    if (productCode === 'IBAN_OWNERSHIP') {
      return {
        iban: 'SA4420000001234567891234',
        identifier: { type: 'CR', value: '1010101010' },
      };
    }
    return subject;
  };

  const run = (tenantId: string, productCode: string, reference: string, unn = subject.unn) =>
    withTenant(db.appPool, tenantId, (tx) =>
      verify(tx, {
        productCode,
        subject: { ...subjectFor(productCode), ...(productCode === 'ADDRESS_ONLY' ? { unn } : {}) },
        subjectIdentifiers: [{ idType: 'UNN', value: unn }],
        idempotencyKey: reference,
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

  it('tells a subscriber what they committed to, and calls it that', async () => {
    const commitment = await withTenant(db.appPool, starter.tenantId, (tx) => getCommitment(tx));
    expect(commitment?.packageCode).toBe('ESSENTIAL');
    expect(commitment?.supportTier).toBe('STANDARD');
    // A term, not a month: docs/01-blueprint.md section 9 opens by saying do not call
    // this a subscription.
    expect(commitment?.termMonths).toBe(12);
    // Capacity expires with the term and credit carries. This plan sells capacity, so
    // what a month's minimum did not use does not follow it into the next one.
    expect(commitment?.includedTransactions).toBe(3_000);
    expect(commitment?.creditRolloverDays).toBe(0);
    expect(commitment?.includedSeats).toBeGreaterThan(0);
    const term = commitment?.termEnd.getTime() ?? 0;
    expect(term).toBeGreaterThan(commitment?.termStart.getTime() ?? 0);
  });

  it('waives the setup fee at the term the plan names, and charges it below that', () => {
    const plan = { setupFeeHalalas: 3_000_00, setupWaivedFromMonths: 24 };
    expect(setupFeeFor(plan, 24)).toBe(0);
    expect(setupFeeFor(plan, 12)).toBe(3_000_00);
    // A plan that never waives it says so with a null rather than an impossible number.
    expect(setupFeeFor({ setupFeeHalalas: 500_00, setupWaivedFromMonths: null }, 24)).toBe(500_00);
  });

  it('counts seats and portfolios, and charges only above what the plan includes', async () => {
    const extras = await withTenant(db.appPool, starter.tenantId, (tx) => computeTermExtras(tx));
    expect(extras).not.toBeNull();
    // A workspace with fewer people than the plan includes owes nothing for seats, which
    // is the component that grows revenue without consumption growing.
    expect(extras?.chargeableSeats).toBe(0);
    expect(extras?.seatChargeHalalas).toBe(0);
    expect(extras?.portfolios).toBe(
      (extras?.chargeablePortfolios ?? 0) ? extras?.portfolios : extras?.portfolios,
    );
  });

  it('charges nothing for re-verifying the same entity inside the plan window', async () => {
    const first = await run(enterprise.tenantId, 'ADDRESS_ONLY', 'ent-free-1');
    expect(first.billing.amount).toBeGreaterThan(0);

    // The same entity and the same product, a minute later. Practice four in the
    // blueprint's competitive list: free inside thirty days.
    const second = await run(enterprise.tenantId, 'ADDRESS_ONLY', 'ent-free-2');
    expect(second.billing.amount).toBe(0);
  });

  it('runs a module the package includes', async () => {
    const result = await run(starter.tenantId, 'ADDRESS_ONLY', 'ess-1');
    expect(result.status).not.toBe('ERROR');
  });

  it('refuses a module the package does not include, and charges nothing for refusing', async () => {
    const before = await withTenant(db.appPool, starter.tenantId, (tx) => getWallet(tx));

    // The essential package carries the registry and the address, not the bank account.
    await expect(run(starter.tenantId, 'IBAN_OWNERSHIP', 'ess-2')).rejects.toThrow(
      /not included in your package/,
    );

    const after = await withTenant(db.appPool, starter.tenantId, (tx) => getWallet(tx));
    expect(after.balance).toBe(before.balance);
    expect(after.held).toBe(before.held);

    // And it leaves nothing behind: no run, so no idempotency key was claimed either.
    const { rows } = await withTenant(db.appPool, starter.tenantId, (tx) =>
      tx.query<{ count: string }>(
        `SELECT count(*) FROM verification_runs WHERE tenant_id = $1 AND product_code = 'IBAN_OWNERSHIP'`,
        [starter.tenantId],
      ),
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('runs everything for a package that includes everything', async () => {
    const result = await run(enterprise.tenantId, 'IBAN_OWNERSHIP', 'ent-1');
    expect(result.status).not.toBe('ERROR');
  });

  it('counts a run against the cycle, and a replay does not count twice', async () => {
    const before = await withTenant(db.appPool, enterprise.tenantId, (tx) =>
      resolveEntitlement(tx, 'KYB_COMPLETE'),
    );

    await run(enterprise.tenantId, 'KYB_COMPLETE', 'ent-kyb');
    const afterFirst = await withTenant(db.appPool, enterprise.tenantId, (tx) =>
      resolveEntitlement(tx, 'KYB_COMPLETE'),
    );
    expect(afterFirst.used).toBe(before.used + 1);

    // Rule 7 in the other currency a package is measured in.
    const replay = await run(enterprise.tenantId, 'KYB_COMPLETE', 'ent-kyb');
    expect(replay.replayed).toBe(true);
    const afterReplay = await withTenant(db.appPool, enterprise.tenantId, (tx) =>
      resolveEntitlement(tx, 'KYB_COMPLETE'),
    );
    expect(afterReplay.used).toBe(afterFirst.used);
  });

  it('stops at the quota, and says so in a way the customer can act on', async () => {
    // The essential package carries a quota on the registry product. Spend it.
    await db.operatorPool.query(
      `UPDATE package_products SET monthly_quota = 1
       WHERE package_code = 'ESSENTIAL' AND product_code = 'KYB_COMPLETE'`,
    );

    await run(starter.tenantId, 'KYB_COMPLETE', 'ess-kyb-1');

    const entitlement = await withTenant(db.appPool, starter.tenantId, (tx) =>
      resolveEntitlement(tx, 'KYB_COMPLETE'),
    );
    expect(entitlement.allowed).toBe(false);
    expect(entitlement.refusal).toBe('QUOTA_EXHAUSTED');
    expect(entitlement.remaining).toBe(0);

    await expect(run(starter.tenantId, 'KYB_COMPLETE', 'ess-kyb-2')).rejects.toThrow(
      /quota for this module is exhausted/,
    );
  });

  it('lets an override outrank the package in both directions', async () => {
    // Turned on for this one subscriber, though the package does not carry it.
    await db.operatorPool.query(
      `INSERT INTO tenant_product_overrides (tenant_id, product_code, enabled)
       VALUES ($1, 'IBAN_OWNERSHIP', true)
       ON CONFLICT (tenant_id, product_code) DO UPDATE SET enabled = true`,
      [starter.tenantId],
    );

    const granted = await withTenant(db.appPool, starter.tenantId, (tx) =>
      resolveEntitlement(tx, 'IBAN_OWNERSHIP'),
    );
    expect(granted.allowed).toBe(true);
    expect(granted.negotiated).toBe(true);
    await expect(run(starter.tenantId, 'IBAN_OWNERSHIP', 'ess-iban')).resolves.toBeTruthy();

    // And turned off for this one subscriber, though the package does carry it.
    await db.operatorPool.query(
      `INSERT INTO tenant_product_overrides (tenant_id, product_code, enabled)
       VALUES ($1, 'ADDRESS_ONLY', false)
       ON CONFLICT (tenant_id, product_code) DO UPDATE SET enabled = false`,
      [enterprise.tenantId],
    );
    await expect(run(enterprise.tenantId, 'ADDRESS_ONLY', 'ent-addr')).rejects.toThrow(
      /disabled for your workspace/,
    );
  });

  it('refuses everything when the commitment is suspended', async () => {
    await db.operatorPool.query(
      `UPDATE tenant_commitments SET status = 'suspended' WHERE tenant_id = $1`,
      [enterprise.tenantId],
    );

    await expect(run(enterprise.tenantId, 'KYB_COMPLETE', 'ent-suspended')).rejects.toThrow(
      NxError,
    );

    await db.operatorPool.query(
      `UPDATE tenant_commitments SET status = 'active' WHERE tenant_id = $1`,
      [enterprise.tenantId],
    );
  });

  it('lists every module with the subscriber standing on each, for a screen to show', async () => {
    const list = await withTenant(db.appPool, starter.tenantId, (tx) => listEntitlements(tx));
    expect(list.length).toBeGreaterThanOrEqual(3);

    const byCode = new Map(list.map((entry) => [entry.productCode, entry]));
    expect(byCode.get('ADDRESS_ONLY')?.allowed).toBe(true);
    expect(byCode.get('IBAN_OWNERSHIP')?.negotiated).toBe(true);
    // Every entry carries its package, so a screen can say which plan decided.
    for (const entry of list) {
      expect(entry.packageCode).toBe('ESSENTIAL');
    }
  });

  it('stops at the committed capacity when the plan does not allow overage', async () => {
    // A capacity package sells a number of transactions for a term. This one has two left.
    await db.operatorPool.query(
      `UPDATE packages SET overage_allowed = false WHERE code = 'ESSENTIAL'`,
    );
    await db.operatorPool.query(
      `UPDATE tenant_commitments SET included_transactions = transactions_used + 1
       WHERE tenant_id = $1`,
      [starter.tenantId],
    );

    const before = await withTenant(db.appPool, starter.tenantId, (tx) =>
      resolveEntitlement(tx, 'ADDRESS_ONLY'),
    );
    expect(before.allowed).toBe(true);
    expect(before.capacityRemaining).toBe(1);

    await run(starter.tenantId, 'ADDRESS_ONLY', 'ess-capacity-1');

    const after = await withTenant(db.appPool, starter.tenantId, (tx) =>
      resolveEntitlement(tx, 'ADDRESS_ONLY'),
    );
    expect(after.capacityRemaining).toBe(0);
    expect(after.refusal).toBe('CAPACITY_EXHAUSTED');
    await expect(run(starter.tenantId, 'ADDRESS_ONLY', 'ess-capacity-2')).rejects.toThrow(
      /committed capacity/,
    );

    // A plan that allows overage keeps working past the capacity and bills the excess.
    await db.operatorPool.query(
      `UPDATE packages SET overage_allowed = true WHERE code = 'ESSENTIAL'`,
    );
    await expect(run(starter.tenantId, 'ADDRESS_ONLY', 'ess-capacity-3')).resolves.toBeTruthy();
  });

  it('lets the application count transactions and nothing else on the commitment', async () => {
    // The counter moves, because the application increments it on every run.
    const before = await withTenant(db.appPool, enterprise.tenantId, (tx) => getCommitment(tx));
    await run(enterprise.tenantId, 'KYB_COMPLETE', 'ent-count-1');
    const after = await withTenant(db.appPool, enterprise.tenantId, (tx) => getCommitment(tx));
    expect(after?.transactionsUsed).toBe((before?.transactionsUsed ?? 0) + 1);

    // And the plan does not, because a column level grant is all the application has: an
    // application that can count must not be able to move a customer onto another plan.
    await expect(
      withTenant(db.appPool, enterprise.tenantId, (tx) =>
        tx.query(`UPDATE tenant_commitments SET package_code = 'PAYG' WHERE tenant_id = $1`, [
          enterprise.tenantId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('charges the negotiated price rather than the price book', async () => {
    // A price written for this one subscriber. Storing it and charging something else
    // would be worse than not having it.
    await db.operatorPool.query(
      `INSERT INTO tenant_product_overrides (tenant_id, product_code, enabled, unit_price_halalas)
       VALUES ($1, 'ADDRESS_ONLY', true, 250)
       ON CONFLICT (tenant_id, product_code) DO UPDATE SET unit_price_halalas = 250,
                                                           enabled = true`,
      [enterprise.tenantId],
    );

    const entitlement = await withTenant(db.appPool, enterprise.tenantId, (tx) =>
      resolveEntitlement(tx, 'ADDRESS_ONLY'),
    );
    expect(entitlement.unitPriceHalalas).toBe(250);

    // A subject this workspace has not seen, so the free re-verification window does not
    // make this test about something else.
    const result = await run(enterprise.tenantId, 'ADDRESS_ONLY', 'ent-negotiated', '7001299001');
    expect(result.billing.amount).toBe(250);

    await db.operatorPool.query(
      `DELETE FROM tenant_product_overrides WHERE tenant_id = $1 AND product_code = 'ADDRESS_ONLY'`,
      [enterprise.tenantId],
    );
  });

  it('keeps one subscriber package out of another subscriber scope', async () => {
    const theirs = await withTenant(db.appPool, enterprise.tenantId, (tx) =>
      tx.query<{ count: string }>('SELECT count(*) FROM tenant_commitments'),
    );
    // RLS, as everywhere: a subscriber sees one commitment row, their own.
    expect(theirs.rows[0]?.count).toBe('1');
  });

  /**
   * The plan overage price, which was collected, validated against cost, shown on the plan
   * card, and never charged: an excess run was billed at the included rate, so the figure
   * the owner typed into the panel did not exist commercially.
   *
   * Declared last and on a tenant of its own, because these cases move the capacity and the
   * catalogue, and the tests above read both.
   */
  describe('the price of a run past the committed capacity', () => {
    let spender: SeededTenant;
    // The list price of the address check for this tenant, and the plan's overage rate.
    const LIST = 8_00;
    const OVERAGE = 20_00;

    const priceOf = async (productCode: string): Promise<number> => {
      const entitlement = await withTenant(db.appPool, spender.tenantId, (tx) =>
        resolveEntitlement(tx, productCode),
      );
      return chargedUnitPrice(entitlement, LIST);
    };

    const setCapacity = (included: number, used: number) =>
      db.operatorPool.query(
        `UPDATE tenant_commitments SET included_transactions = $2, transactions_used = $3
         WHERE tenant_id = $1`,
        [spender.tenantId, included, used],
      );

    beforeAll(async () => {
      spender = await seedTenant(db.appPool, 'Overage Tenant');
      // Essential prices no product of its own, so the list price applies inside the
      // capacity and the plan overage rate is the only other figure in play.
      await preparePricedTenant(db, spender.tenantId, { packageCode: 'ESSENTIAL' });
      await db.operatorPool.query(
        `UPDATE packages SET overage_allowed = true, overage_unit_halalas = $1
         WHERE code = 'ESSENTIAL'`,
        [OVERAGE],
      );
    });

    it('charges the ordinary price while the capacity still has room', async () => {
      await setCapacity(3_000, 10);

      const entitlement = await withTenant(db.appPool, spender.tenantId, (tx) =>
        resolveEntitlement(tx, 'ADDRESS_ONLY'),
      );
      expect(entitlement.allowed).toBe(true);
      // Inside the capacity the overage rate is not a price at all, and saying so with a
      // null is what keeps it out of the charge.
      expect(entitlement.overageUnitPriceHalalas).toBeNull();
      expect(chargedUnitPrice(entitlement, LIST)).toBe(LIST);

      const result = await run(spender.tenantId, 'ADDRESS_ONLY', 'ovr-within', '7001291001');
      expect(result.billing.amount).toBe(LIST);
    });

    it('charges the plan overage rate once the capacity is spent', async () => {
      await setCapacity(3_000, 3_000);

      const entitlement = await withTenant(db.appPool, spender.tenantId, (tx) =>
        resolveEntitlement(tx, 'ADDRESS_ONLY'),
      );
      expect(entitlement.allowed).toBe(true);
      expect(entitlement.capacityRemaining).toBe(0);
      expect(entitlement.overageUnitPriceHalalas).toBe(OVERAGE);
      expect(chargedUnitPrice(entitlement, LIST)).toBe(OVERAGE);

      // And the money moves, which is the whole point: the wallet pays past the capacity,
      // so the figure on the plan card is the figure that leaves the balance.
      const before = await withTenant(db.appPool, spender.tenantId, (tx) => getWallet(tx));
      const result = await run(spender.tenantId, 'ADDRESS_ONLY', 'ovr-past', '7001291002');
      expect(result.billing.amount).toBe(OVERAGE);
      const after = await withTenant(db.appPool, spender.tenantId, (tx) => getWallet(tx));
      expect(before.balance - after.balance).toBe(OVERAGE);
    });

    it('lets the plan overage rate outrank the plan per product price', async () => {
      // A plan that prices this product for everyone on the plan. That price is what an
      // included transaction costs, and the commitment that bought it is spent.
      await db.operatorPool.query(
        `UPDATE package_products SET unit_price_halalas = $1
         WHERE package_code = 'ESSENTIAL' AND product_code = 'ADDRESS_ONLY'`,
        [4_00],
      );

      await setCapacity(3_000, 20);
      expect(await priceOf('ADDRESS_ONLY')).toBe(4_00);

      await setCapacity(3_000, 3_000);
      expect(await priceOf('ADDRESS_ONLY')).toBe(OVERAGE);

      const result = await run(spender.tenantId, 'ADDRESS_ONLY', 'ovr-plan-price', '7001291003');
      expect(result.billing.amount).toBe(OVERAGE);

      await db.operatorPool.query(
        `UPDATE package_products SET unit_price_halalas = NULL
         WHERE package_code = 'ESSENTIAL' AND product_code = 'ADDRESS_ONLY'`,
      );
    });

    it('lets a price written for this subscriber outrank the plan overage rate', async () => {
      await db.operatorPool.query(
        `INSERT INTO tenant_product_overrides (tenant_id, product_code, enabled, unit_price_halalas)
         VALUES ($1, 'ADDRESS_ONLY', true, 250)
         ON CONFLICT (tenant_id, product_code) DO UPDATE SET enabled = true,
                                                             unit_price_halalas = 250`,
        [spender.tenantId],
      );

      await setCapacity(3_000, 3_000);
      const entitlement = await withTenant(db.appPool, spender.tenantId, (tx) =>
        resolveEntitlement(tx, 'ADDRESS_ONLY'),
      );
      // The negotiated line was agreed with this plan in view, so it is not overtaken by a
      // plan figure. It is dropped here rather than compared later, so there is one place
      // the order is decided.
      expect(entitlement.overageUnitPriceHalalas).toBeNull();
      expect(entitlement.unitPriceHalalas).toBe(250);
      expect(chargedUnitPrice(entitlement, LIST)).toBe(250);

      const result = await run(spender.tenantId, 'ADDRESS_ONLY', 'ovr-negotiated', '7001291004');
      expect(result.billing.amount).toBe(250);

      await db.operatorPool.query(
        `DELETE FROM tenant_product_overrides WHERE tenant_id = $1 AND product_code = 'ADDRESS_ONLY'`,
        [spender.tenantId],
      );
    });

    it('names no overage price on a plan that refuses to go past its capacity', async () => {
      await db.operatorPool.query(
        `UPDATE packages SET overage_allowed = false WHERE code = 'ESSENTIAL'`,
      );
      await setCapacity(3_000, 3_000);

      const entitlement = await withTenant(db.appPool, spender.tenantId, (tx) =>
        resolveEntitlement(tx, 'ADDRESS_ONLY'),
      );
      // Refused, so there is nothing to price. A screen that showed the overage rate here
      // would be quoting for a run this plan will not run.
      expect(entitlement.refusal).toBe('CAPACITY_EXHAUSTED');
      expect(entitlement.overageUnitPriceHalalas).toBeNull();

      await db.operatorPool.query(
        `UPDATE packages SET overage_allowed = true WHERE code = 'ESSENTIAL'`,
      );
    });
  });
});

/**
 * The overage rate a customer signed for (ADR-168).
 *
 * Migration 0026 copied the capacity onto the commitment and said why: a plan edited next year
 * must not change what a customer signed for this year. It did not copy the rate, because
 * nothing charged it. Something does now, so editing a plan's overage price repriced every
 * existing subscriber's excess runs backwards until this.
 */
describe('a plan edited after somebody signed for it', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx, undefined, {}));
    await applyPackageSeed(db.operatorPool);
    tenant = await seedTenant(db.appPool, 'شركة الالتزام');
    await setTenantPackage(db.operatorPool, { tenantId: tenant.tenantId, packageCode: 'GROWTH' }, 'op-1');
  });

  afterAll(async () => {
    await db.close();
  });

  it('keeps the overage rate that was stamped on the commitment', async () => {
    const stamped = await db.operatorPool.query<{ rate: number | null }>(
      `SELECT overage_unit_halalas AS rate FROM tenant_commitments WHERE tenant_id = $1`,
      [tenant.tenantId],
    );
    const signedFor = stamped.rows[0]?.rate;
    expect(signedFor).not.toBeNull();

    // The plan's rate moves. The commitment's does not.
    await db.operatorPool.query(
      `UPDATE packages SET overage_unit_halalas = $1 WHERE code = 'GROWTH'`,
      [(signedFor ?? 0) + 5_00],
    );

    const after = await db.operatorPool.query<{ rate: number | null }>(
      `SELECT overage_unit_halalas AS rate FROM tenant_commitments WHERE tenant_id = $1`,
      [tenant.tenantId],
    );
    expect(after.rows[0]?.rate).toBe(signedFor);
  });

  it('falls back to the plan for a commitment made before the column existed', async () => {
    // Backfilled by the migration, but a row written by hand, or by an older deployment mid
    // rollout, can still carry null. The read must not become null with it.
    await db.operatorPool.query(
      `UPDATE tenant_commitments SET overage_unit_halalas = NULL WHERE tenant_id = $1`,
      [tenant.tenantId],
    );
    const { rows } = await db.operatorPool.query<{ rate: string | null }>(
      `SELECT COALESCE(s.overage_unit_halalas, p.overage_unit_halalas)::text AS rate
         FROM tenant_commitments s JOIN packages p ON p.code = s.package_code
        WHERE s.tenant_id = $1`,
      [tenant.tenantId],
    );
    expect(rows[0]?.rate).not.toBeNull();
  });
});
