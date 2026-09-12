import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import {
  getSubscription,
  listEntitlements,
  resolveEntitlement,
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

  const run = (tenantId: string, productCode: string, reference: string) =>
    withTenant(db.appPool, tenantId, (tx) =>
      verify(tx, {
        productCode,
        subject: subjectFor(productCode),
        subjectIdentifiers: [{ idType: 'UNN', value: subject.unn }],
        idempotencyKey: reference,
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

  it('tells a subscriber what their package is', async () => {
    const subscription = await withTenant(db.appPool, starter.tenantId, (tx) =>
      getSubscription(tx),
    );
    expect(subscription?.packageCode).toBe('ESSENTIAL');
    expect(subscription?.supportTier).toBe('STANDARD');
    expect(subscription?.maxUsers).toBe(5);
    const period = subscription?.periodEnd.getTime() ?? 0;
    expect(period).toBeGreaterThan(subscription?.periodStart.getTime() ?? 0);
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

  it('refuses everything when the subscription is suspended', async () => {
    await db.operatorPool.query(
      `UPDATE tenant_subscriptions SET status = 'suspended' WHERE tenant_id = $1`,
      [enterprise.tenantId],
    );

    await expect(run(enterprise.tenantId, 'KYB_COMPLETE', 'ent-suspended')).rejects.toThrow(
      NxError,
    );

    await db.operatorPool.query(
      `UPDATE tenant_subscriptions SET status = 'active' WHERE tenant_id = $1`,
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

  it('keeps one subscriber package out of another subscriber scope', async () => {
    const theirs = await withTenant(db.appPool, enterprise.tenantId, (tx) =>
      tx.query<{ count: string }>('SELECT count(*) FROM tenant_subscriptions'),
    );
    // RLS, as everywhere: a subscriber sees one subscription row, their own.
    expect(theirs.rows[0]?.count).toBe('1');
  });
});
