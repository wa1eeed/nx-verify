import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../packages/db/src/client.js';
import { verify } from '../../packages/core/src/verification/verify.js';
import { getLedger, getWallet } from '../../packages/core/src/billing/wallet.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../helpers/db.js';
import { preparePricedTenant, providerFixture } from '../helpers/billing.js';

/**
 * Guard 03: the same Idempotency-Key returns the same result and is charged once.
 *
 * Rule 7. One network hiccup on the customer's side must not become two queries and two
 * charges, because that is a billing dispute in the first week of an integration.
 *
 * The key is claimed by inserting a PENDING run before anything is called, so a duplicate
 * loses at the unique index and never reaches a provider at all. Checking for an existing
 * run first and inserting afterwards would leave a window in which two concurrent
 * requests both find nothing, both call, and both charge. The concurrency case below is
 * what distinguishes the two designs.
 */

describe('guard 03: same key, same result, one charge', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Guard 03 Tenant');
    await preparePricedTenant(db, tenant.tenantId);
  });

  afterAll(async () => {
    await db.close();
  });

  const run = (idempotencyKey: string | null, unn = '7001272184') =>
    withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn },
        subjectIdentifiers: [{ idType: 'UNN', value: unn }],
        idempotencyKey,
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

  it('returns the same run for the same key', async () => {
    const key = `idem-${randomUUID()}`;
    const first = await run(key);
    const second = await run(key);

    expect(second.runId).toBe(first.runId);
    expect(second.replayed).toBe(true);
    expect(second.status).toBe(first.status);
  });

  it('charges once for the same key', async () => {
    const key = `idem-${randomUUID()}`;
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    const first = await run(key);
    const afterFirst = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    await run(key);
    const afterSecond = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    expect(before.balance - afterFirst.balance).toBe(first.billing.amount);
    expect(afterSecond.balance).toBe(afterFirst.balance);

    const charges = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getLedger(tx, { runId: first.runId }),
    );
    expect(charges.filter((entry) => entry.reason === 'CHARGE')).toHaveLength(1);
  });

  it('calls the provider once for the same key', async () => {
    const key = `idem-${randomUUID()}`;
    fixture.provider.resetCallCount();

    await run(key);
    const afterFirst = fixture.provider.callCount;
    await run(key);

    expect(afterFirst).toBeGreaterThan(0);
    // The replay never reaches a provider, so it costs us nothing either.
    expect(fixture.provider.callCount).toBe(afterFirst);
  });

  it('charges once when two requests with the same key race', async () => {
    const key = `idem-${randomUUID()}`;
    fixture.provider.resetCallCount();
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    const [left, right] = await Promise.all([run(key), run(key)]);

    expect(left.runId).toBe(right.runId);
    expect([left.replayed, right.replayed].filter(Boolean)).toHaveLength(1);

    const after = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    const executed = left.replayed ? right : left;
    expect(before.balance - after.balance).toBe(executed.billing.amount);
    expect(fixture.provider.callCount).toBe(1);
  });

  it('treats different keys as different runs', async () => {
    const first = await run(`idem-${randomUUID()}`);
    const second = await run(`idem-${randomUUID()}`);
    expect(second.runId).not.toBe(first.runId);
    expect(second.replayed).toBe(false);
  });

  it('does not deduplicate when no key is supplied', async () => {
    const first = await run(null);
    const second = await run(null);
    expect(second.runId).not.toBe(first.runId);
  });

  it('scopes the key to the tenant', async () => {
    const key = `idem-${randomUUID()}`;
    const other = await seedTenant(db.appPool, 'Guard 03 Other Tenant');
    await preparePricedTenant(db, other.tenantId);

    const mine = await run(key);
    const theirs = await withTenant(db.appPool, other.tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn: '7001272184' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7001272184' }],
        idempotencyKey: key,
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

    // Two customers may use the same key. They are different runs.
    expect(theirs.runId).not.toBe(mine.runId);
    expect(theirs.replayed).toBe(false);
  });
});
