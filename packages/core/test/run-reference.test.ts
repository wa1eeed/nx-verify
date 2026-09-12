import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { getVerification, verify } from '../src/verification/verify.js';

import { getWallet } from '../src/billing/wallet.js';
import { getCommitment } from '../src/billing/entitlements.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * Unit 43 acceptance: a number a person can read, and a package that is a purchase.
 *
 * Both are things a customer asks for on a call. The first is asked as "which one are we
 * talking about", and a uuid is not an answer anybody reads out loud. The second is asked
 * as "why is my balance going down when I already bought three thousand".
 */

describe('the reference and where a run is paid from', () => {
  let db: TestDatabase;
  let packaged: SeededTenant;
  let payg: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    packaged = await seedTenant(db.appPool, 'Packaged');
    payg = await seedTenant(db.appPool, 'Pay As You Go');

    await preparePricedTenant(db, packaged.tenantId, { packageCode: 'ESSENTIAL' });
    await preparePricedTenant(db, payg.tenantId, { packageCode: 'PAYG' });
  });

  afterAll(async () => {
    await db.close();
  });

  const run = (tenantId: string, unn = '7001272184') =>
    withTenant(db.appPool, tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn },
        subjectIdentifiers: [{ idType: 'UNN', value: unn }],
        idempotencyKey: randomUUID(),
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

  const readRun = (tenantId: string, runId: string) =>
    withTenant(db.appPool, tenantId, (tx) =>
      tx.query<{ reference: string; charge_source: string; billed_amount: string }>(
        `SELECT reference, charge_source, billed_amount::text FROM verification_runs
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, runId],
      ),
    );

  it('gives every run a reference a person can read out loud', async () => {
    const result = await run(packaged.tenantId);
    const row = (await readRun(packaged.tenantId, result.runId)).rows[0];

    expect(row?.reference).toMatch(/^VRF-\d{4}-\d{6}$/);
    // The uuid is still there and still the identifier. The reference is for people.
    expect(row?.reference).not.toContain(result.runId);
  });

  it('counts per subscriber, so a customer cannot read our volume off their own numbers', async () => {
    const first = await run(packaged.tenantId, '7001272185');
    const second = await run(packaged.tenantId, '7001272186');

    const one = (await readRun(packaged.tenantId, first.runId)).rows[0]?.reference ?? '';
    const two = (await readRun(packaged.tenantId, second.runId)).rows[0]?.reference ?? '';
    expect(Number(two.slice(-6))).toBe(Number(one.slice(-6)) + 1);

    // Another subscriber starts from its own beginning rather than continuing ours.
    const other = await run(payg.tenantId, '7001272187');
    const theirs = (await readRun(payg.tenantId, other.runId)).rows[0]?.reference ?? '';
    expect(Number(theirs.slice(-6))).toBeLessThan(Number(two.slice(-6)));
  });

  it('draws on the package while capacity lasts, and moves no money', async () => {
    const before = await withTenant(db.appPool, packaged.tenantId, (tx) => getWallet(tx));
    const result = await run(packaged.tenantId, '7001272188');
    const after = await withTenant(db.appPool, packaged.tenantId, (tx) => getWallet(tx));

    const row = (await readRun(packaged.tenantId, result.runId)).rows[0];
    expect(row?.charge_source).toBe('PACKAGE');
    // Bought when the commitment was signed. Charging the wallet too would mean paying
    // for it twice, and would make the package a limit rather than a purchase.
    expect(after.balance).toBe(before.balance);
    expect(after.held).toBe(before.held);

    // And it is still priced, so a statement can show what the package was worth.
    expect(Number(row?.billed_amount)).toBeGreaterThan(0);
    expect(result.billing.amount).toBeGreaterThan(0);
  });

  it('draws on the wallet once the capacity is gone', async () => {
    await db.operatorPool.query(
      `UPDATE tenant_commitments SET included_transactions = transactions_used
       WHERE tenant_id = $1`,
      [packaged.tenantId],
    );

    const before = await withTenant(db.appPool, packaged.tenantId, (tx) => getWallet(tx));
    const result = await run(packaged.tenantId, '7001272189');
    const after = await withTenant(db.appPool, packaged.tenantId, (tx) => getWallet(tx));

    const row = (await readRun(packaged.tenantId, result.runId)).rows[0];
    expect(row?.charge_source).toBe('WALLET');
    expect(after.balance).toBeLessThan(before.balance);
  });

  it('draws on the wallet from the first run when the plan sells no capacity', async () => {
    const commitment = await withTenant(db.appPool, payg.tenantId, (tx) => getCommitment(tx));
    expect(commitment?.includedTransactions).toBeNull();

    const before = await withTenant(db.appPool, payg.tenantId, (tx) => getWallet(tx));
    const result = await run(payg.tenantId, '7001272190');
    const after = await withTenant(db.appPool, payg.tenantId, (tx) => getWallet(tx));

    expect((await readRun(payg.tenantId, result.runId)).rows[0]?.charge_source).toBe('WALLET');
    expect(after.balance).toBeLessThan(before.balance);
  });

  it('carries the reference into the run a customer reads', async () => {
    const result = await run(payg.tenantId, '7001272191');
    const view = await withTenant(db.appPool, payg.tenantId, (tx) =>
      getVerification(tx, result.runId),
    );
    expect(view?.reference).toMatch(/^VRF-/);
  });
});
