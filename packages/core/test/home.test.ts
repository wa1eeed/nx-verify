import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { runChecks, type RunChecksDependencies } from '../src/customers/checks.js';
import { homeOverview, riyadhMonthStart } from '../src/customers/home.js';
import { summarizeCustomers } from '../src/customers/summaries.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';
import {
  SANDBOX_FREELANCER,
  SANDBOX_IBAN,
  SANDBOX_UNN,
} from '../../../packages/providers/src/stub/verification-sandbox.js';

/**
 * Handoff phase 5: the subscriber's home screen, counted from real verifications.
 *
 * The figures on the home screen are the same summaries the customers list draws, so each is
 * asserted against those summaries rather than against a number worked out by hand, and the
 * month is Riyadh's month whatever the server's clock says.
 */

describe('the home overview', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let other: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  const deps = (tenantId: string): RunChecksDependencies => ({
    inTenant: (work) => withTenant(db.appPool, tenantId, work),
    keys,
    runStepFor: (tx) => fixture.runnerFor(tx),
  });
  const run = (
    kind: 'BUSINESS' | 'FREELANCER',
    identity: Record<string, string>,
    productCodes: string[],
    iban?: string,
  ) =>
    runChecks(deps(tenant.tenantId), {
      kind,
      identity,
      productCodes,
      ...(iban === undefined ? {} : { inputs: { iban } }),
      bundleKey: randomUUID(),
      requestedBy: null,
    });

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Home Tenant');
    other = await seedTenant(db.appPool, 'Quiet Subscriber');
    await preparePricedTenant(db, tenant.tenantId, { balanceHalalas: 50_000_00 });
    await preparePricedTenant(db, other.tenantId, { balanceHalalas: 50_000_00 });

    await run(
      'BUSINESS',
      { unn: SANDBOX_UNN.ACTIVE },
      [
        'CR_FULL',
        'ARTICLES_OF_ASSOCIATION',
        'MANAGER_AUTHORITY',
        'NATIONAL_ADDRESS',
        'IBAN_VERIFICATION',
      ],
      SANDBOX_IBAN.OTHER_NAME,
    );
    await run('BUSINESS', { unn: SANDBOX_UNN.SUSPENDED }, ['CR_FULL']);
    await run('BUSINESS', { unn: SANDBOX_UNN.ESTABLISHMENT }, ['CR_FULL']);
    await run(
      'FREELANCER',
      { nationalId: SANDBOX_FREELANCER.NATIONAL_ID, certificateNumber: SANDBOX_FREELANCER.ACTIVE },
      ['FREELANCE_CERTIFICATE'],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('starts the month at midnight in Riyadh, three hours before midnight in UTC', () => {
    expect(riyadhMonthStart(new Date('2026-09-14T09:00:00Z')).toISOString()).toBe(
      '2026-08-31T21:00:00.000Z',
    );
    // Half past midnight on the first in Riyadh is already the new month.
    expect(riyadhMonthStart(new Date('2026-09-30T21:30:00Z')).toISOString()).toBe(
      '2026-09-30T21:00:00.000Z',
    );
  });

  it('counts customers the way their summaries stand', async () => {
    const [home, summaries] = await withTenant(
      db.appPool,
      tenant.tenantId,
      async (tx) =>
        [
          await homeOverview(tx, keys),
          await summarizeCustomers(tx, keys, { limit: 5_000 }),
        ] as const,
    );

    expect(home.subscriberName).toBe('Home Tenant');
    expect(home.customers.all).toBe(4);
    expect(home.customers.verified).toBe(
      summaries.filter((summary) => summary.completeness === 100).length,
    );
    expect(home.customers.verified + home.customers.incomplete).toBe(home.customers.all);
    expect(home.customers.verifiedThisMonth).toBe(home.customers.verified);
    expect(home.customers.incomplete).toBe(
      summaries.filter((summary) => summary.completeness < 100).length,
    );
    // The suspended registry and the account in another name, at least.
    expect(home.customers.conflicts).toBeGreaterThanOrEqual(2);
    expect(home.dataUpdatedAt).toBeInstanceOf(Date);
    expect(home.commitment?.termEnd).toBeInstanceOf(Date);
  });

  it('lists the latest operations, and marks the account whose holder does not match', async () => {
    const home = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      homeOverview(tx, keys, { recent: 20 }),
    );
    const iban = home.recent.find((entry) => entry.productCode === 'IBAN_VERIFICATION');
    expect(iban?.conflictAr).toBe('تعارض في الاسم');
    const registry = home.recent.find(
      (entry) => entry.productCode === 'CR_FULL' && entry.entityName === 'شركة اختبار للتجارة',
    );
    expect(registry?.conflictAr).toBeNull();
  });

  it('counts what the month consumed by product, most first, and how the calls went', async () => {
    const home = await withTenant(db.appPool, tenant.tenantId, (tx) => homeOverview(tx, keys));
    const counts = home.consumption.map((entry) => entry.count);
    expect([...counts].sort((left, right) => right - left)).toEqual(counts);
    expect(home.consumption.find((entry) => entry.productCode === 'CR_FULL')?.count).toBe(3);
    expect(home.consumption.find((entry) => entry.productCode === 'CR_FULL')?.nameAr).toBe(
      'السجل التجاري',
    );
    expect(home.performance.runs).toBeGreaterThan(0);
    expect(home.performance.completedShare).toBeGreaterThan(0);
  });

  it('shows another subscriber nothing of this one', async () => {
    const quiet = await withTenant(db.appPool, other.tenantId, (tx) => homeOverview(tx, keys));
    expect(quiet.customers).toEqual({
      all: 0,
      verified: 0,
      verifiedThisMonth: 0,
      incomplete: 0,
      conflicts: 0,
    });
    expect(quiet.recent).toEqual([]);
    expect(quiet.consumption).toEqual([]);
    expect(quiet.performance).toEqual({ runs: 0, averageMs: null, completedShare: null });
  });
});
