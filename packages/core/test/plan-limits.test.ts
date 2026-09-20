import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { applyProductSeed } from '../../../packages/db/src/seed/products.js';
import { applyPackageSeed } from '../../../packages/db/src/seed/packages.js';
import {
  DEFAULT_RATE_LIMIT_RPM,
  assertUnderPlanLimit,
  planLimitRefusal,
  planLimits,
  rateLimitRpmFor,
} from '../src/billing/entitlements.js';
import { issueApiKey, listApiKeys } from '../src/auth/api-keys.js';
import { createMonitor } from '../src/monitoring/monitors.js';
import { createUser, disableUser, enableUser, listUsers } from '../src/auth/users.js';
import { NxError } from '../src/errors.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';

/**
 * The four figures every plan sold and nothing ever read (ADR-184).
 *
 * `max_api_keys`, `max_monitors`, `max_users` and `rate_limit_rpm` were set on every package,
 * carried into `Commitment`, and then dropped: keys and monitors were opened without a count,
 * and one rate ceiling of a hundred and twenty was applied to the enterprise plan that had
 * bought six hundred. A subscriber was therefore charged for capacity they could not use and
 * held to a ceiling they had never been sold.
 *
 * What is proven here is the whole of that: that each ceiling now refuses the one past it and
 * admits the one that reaches it exactly, that null is no ceiling rather than a ceiling of
 * zero, that two subscribers on two plans meet two different numbers, and that a workspace
 * already above a ceiling keeps everything it holds.
 */

/** A tenant on this plan, with nothing else about it set up. */
async function commit(db: TestDatabase, tenantId: string, packageCode: string): Promise<void> {
  await db.operatorPool.query(
    `INSERT INTO tenant_commitments (tenant_id, package_code, term_months,
                                     credits_granted_halalas, setup_fee_halalas,
                                     included_transactions, platform_fee_halalas)
     SELECT $1, p.code, p.term_months, p.commitment_credits_halalas, p.setup_fee_halalas,
            p.included_transactions, p.platform_fee_halalas
       FROM packages p WHERE p.code = $2
     ON CONFLICT (tenant_id) DO UPDATE SET package_code = EXCLUDED.package_code,
                                           status = 'active'`,
    [tenantId, packageCode],
  );
}

describe('the ceilings a plan sells', () => {
  let db: TestDatabase;
  let essential: SeededTenant;
  let enterprise: SeededTenant;
  let tight: SeededTenant;
  let unsubscribed: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    // A monitor names the product it re-runs, and a product is a row rather than a constant
    // (rule 8), so the catalogue exists before anything points at one.
    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx));
    await applyPackageSeed(db.operatorPool);

    essential = await seedTenant(db.appPool, 'Essential Tenant');
    enterprise = await seedTenant(db.appPool, 'Enterprise Tenant');
    tight = await seedTenant(db.appPool, 'Tight Tenant');
    unsubscribed = await seedTenant(db.appPool, 'Unsubscribed Tenant');

    await commit(db, essential.tenantId, 'ESSENTIAL');
    await commit(db, enterprise.tenantId, 'ENTERPRISE');
    await commit(db, tight.tenantId, 'GROWTH');

    // The growth plan sells five hundred monitors and no seat ceiling at all, and opening five
    // hundred monitors to watch a ceiling work would prove the same thing five hundred times
    // more slowly. Its figures are narrowed here, on this database alone, so the behaviour can
    // be read at two. The shipped figures are asserted separately, below, unmodified.
    await db.operatorPool.query(
      `UPDATE packages SET max_monitors = 2, max_users = 2 WHERE code = 'GROWTH'`,
    );
  });

  afterAll(async () => {
    await db.close();
  });

  const limits = (tenant: SeededTenant) =>
    withTenant(db.appPool, tenant.tenantId, (tx) => planLimits(tx));

  const key = (tenant: SeededTenant, name: string) =>
    withTenant(db.appPool, tenant.tenantId, (tx) => issueApiKey(tx, { name }));

  const monitor = (tenant: SeededTenant) =>
    withTenant(db.appPool, tenant.tenantId, (tx) =>
      createMonitor(tx, {
        entityId: tenant.entityId,
        productCode: 'KYB_COMPLETE',
        fieldPaths: ['cr.status'],
        cadence: 'MONTHLY',
        budgetCapPerPeriod: 10_00,
        activatedBy: 'user:risk-lead',
      }),
    );

  const user = (tenant: SeededTenant, email: string) =>
    withTenant(db.appPool, tenant.tenantId, (tx) =>
      createUser(tx, { email, displayName: email, role: 'VIEWER' }),
    );

  it('reads what each plan actually sells, rather than one figure for everybody', async () => {
    const essentialLimits = await limits(essential);
    expect(essentialLimits.committed).toBe(true);
    expect(essentialLimits.apiKeys.limit).toBe(2);
    expect(essentialLimits.monitors.limit).toBe(25);
    expect(essentialLimits.rateLimitRpm).toBe(60);

    const enterpriseLimits = await limits(enterprise);
    expect(enterpriseLimits.apiKeys.limit).toBeNull();
    expect(enterpriseLimits.monitors.limit).toBeNull();
    expect(enterpriseLimits.users.limit).toBeNull();
    expect(enterpriseLimits.rateLimitRpm).toBe(600);
  });

  it('admits the key that reaches the ceiling exactly, and refuses the one past it', async () => {
    await key(essential, 'first');
    await key(essential, 'second');

    const atLimit = await limits(essential);
    expect(atLimit.apiKeys.used).toBe(2);
    expect(atLimit.apiKeys.remaining).toBe(0);
    expect(atLimit.apiKeys.atLimit).toBe(true);
    expect(atLimit.apiKeys.over).toBe(false);

    await expect(key(essential, 'third')).rejects.toThrow(NxError);
  });

  it('says the number in the refusal, rather than saying no', async () => {
    const refused = await key(essential, 'fourth').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(NxError);
    const error = refused as NxError;
    // Our catalogue, with retryable stated rather than inferred: revoking a key is the only
    // thing that makes room, so repeating the call unchanged can never succeed.
    expect(error.code).toBe('NX-4003');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('2');
    expect(error.message.toLowerCase()).toContain('api keys');
  });

  it('offers the subscriber the same sentence, with the number in it', () => {
    expect(planLimitRefusal('API_KEYS', 10).ar).toContain('10');
    expect(planLimitRefusal('API_KEYS', 10).ar).toContain('حدّ باقتك');
    expect(planLimitRefusal('MONITORS', 25).en).toBe('Plan limit reached: 25 monitors');
  });

  it('does not count a revoked key against the ceiling it no longer occupies', async () => {
    const keys = await withTenant(db.appPool, essential.tenantId, (tx) => listApiKeys(tx));
    const first = keys.find((row) => row.name === 'first');
    expect(first).toBeDefined();

    await db.appPool.query('SELECT 1');
    await withTenant(db.appPool, essential.tenantId, (tx) =>
      tx.query(`UPDATE api_keys SET revoked_at = now() WHERE tenant_id = $1 AND id = $2`, [
        essential.tenantId,
        first?.id,
      ]),
    );

    const after = await limits(essential);
    expect(after.apiKeys.used).toBe(1);
    expect(after.apiKeys.atLimit).toBe(false);
    // And the slot it freed is usable, which is the whole point of not counting it. The
    // prefix carries four random characters after the environment, so it is matched by shape
    // rather than by equality: asserting the whole string would pin the generator, not the
    // ceiling this file is about.
    const replacement = await key(essential, 'replacement');
    expect(replacement.prefix).toMatch(/^nx_live_/);
  });

  it('lets a plan that sells no ceiling open as many as anybody asks for', async () => {
    await key(enterprise, 'one');
    await key(enterprise, 'two');
    await key(enterprise, 'three');
    await monitor(enterprise);
    await monitor(enterprise);
    await monitor(enterprise);

    const open = await limits(enterprise);
    expect(open.apiKeys.used).toBe(3);
    expect(open.apiKeys.remaining).toBeNull();
    expect(open.apiKeys.atLimit).toBe(false);
    expect(open.monitors.used).toBe(3);
    expect(open.monitors.atLimit).toBe(false);
  });

  it('keeps one subscriber count out of another subscriber ceiling', async () => {
    const essentialLimits = await limits(essential);
    // Two keys live in this workspace and three in the other, and neither number moved.
    expect(essentialLimits.apiKeys.used).toBe(2);
  });

  it('stops the third monitor on a plan that sells two, and leaves the two alone', async () => {
    await monitor(tight);
    await monitor(tight);

    const atLimit = await limits(tight);
    expect(atLimit.monitors.used).toBe(2);
    expect(atLimit.monitors.atLimit).toBe(true);

    await expect(monitor(tight)).rejects.toThrow(/2 monitors/);
    // Nothing was taken from the two that already run.
    expect((await limits(tight)).monitors.used).toBe(2);
  });

  it('stops the third seat on a plan that sells two, at the invitation', async () => {
    await user(tight, 'first@example.com');
    await user(tight, 'second@example.com');

    await expect(user(tight, 'third@example.com')).rejects.toThrow(/2 users/);
    expect((await limits(tight)).users.used).toBe(2);
  });

  it('counts a seat again when a disabled user is brought back', async () => {
    const people = await withTenant(db.appPool, tight.tenantId, (tx) => listUsers(tx));
    const second = people.find((row) => row.email === 'second@example.com');
    expect(second).toBeDefined();
    const actor = '11111111-1111-1111-1111-111111111111';

    await withTenant(db.appPool, tight.tenantId, (tx) =>
      disableUser(tx, second?.userId ?? '', actor),
    );
    // A disabled user is not a seat, which is the same rule the term extras bill on.
    expect((await limits(tight)).users.used).toBe(1);

    // The seat it freed may be taken by somebody new, or by the same person coming back.
    await user(tight, 'third@example.com');
    await expect(
      withTenant(db.appPool, tight.tenantId, (tx) => enableUser(tx, second?.userId ?? '', actor)),
    ).rejects.toThrow(/2 users/);
  });

  it('leaves a workspace that is already above a ceiling holding everything it has', async () => {
    // Three keys were opened on a plan that sells no ceiling. The subscriber then moves onto a
    // plan that sells two, which is the move that used to be impossible to make safely.
    await commit(db, enterprise.tenantId, 'ESSENTIAL');

    const over = await limits(enterprise);
    expect(over.apiKeys.limit).toBe(2);
    expect(over.apiKeys.used).toBe(3);
    expect(over.apiKeys.over).toBe(true);
    expect(over.apiKeys.remaining).toBe(0);

    // Not one of the three was revoked: a running integration is not broken to tidy a number.
    const keys = await withTenant(db.appPool, enterprise.tenantId, (tx) => listApiKeys(tx));
    expect(keys.filter((row) => row.revokedAt === null)).toHaveLength(3);

    // And a fourth is refused, which is where the ceiling actually bites.
    await expect(key(enterprise, 'fourth')).rejects.toThrow(/2 API keys/);

    await commit(db, enterprise.tenantId, 'ENTERPRISE');
  });

  it('caps nothing for a workspace with no plan behind it', async () => {
    const none = await limits(unsubscribed);
    expect(none.committed).toBe(false);
    expect(none.apiKeys.limit).toBeNull();
    expect(none.monitors.limit).toBeNull();
    expect(none.users.limit).toBeNull();

    await expect(
      withTenant(db.appPool, unsubscribed.tenantId, (tx) =>
        assertUnderPlanLimit(tx, 'API_KEYS'),
      ),
    ).resolves.toMatchObject({ limit: null });
  });

  it('gives two subscribers on two plans two different call ceilings', async () => {
    const essentialRpm = await withTenant(db.appPool, essential.tenantId, (tx) =>
      rateLimitRpmFor(tx),
    );
    const enterpriseRpm = await withTenant(db.appPool, enterprise.tenantId, (tx) =>
      rateLimitRpmFor(tx),
    );

    expect(essentialRpm).toBe(60);
    expect(enterpriseRpm).toBe(600);
    expect(enterpriseRpm).not.toBe(essentialRpm);
    // The figure the platform applied to both of them before this existed.
    expect(DEFAULT_RATE_LIMIT_RPM).toBe(120);
  });

  it('falls back to the platform figure when no plan names one', async () => {
    const rpm = await withTenant(db.appPool, unsubscribed.tenantId, (tx) => rateLimitRpmFor(tx));
    expect(rpm).toBe(DEFAULT_RATE_LIMIT_RPM);
  });
});
