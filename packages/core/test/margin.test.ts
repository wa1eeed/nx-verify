import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import { marginReport } from '../src/billing/margin.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * Unit 48 acceptance: the operator can see margin without being able to see customers.
 *
 * This is the tension the whole test is about. A panel that totals revenue per customer
 * per service must not be one query away from reading a decision about a named company,
 * and the answer is the shape of the row rather than the discipline of whoever writes the
 * next query.
 */

describe('the margin report', () => {
  let db: TestDatabase;
  let one: SeededTenant;
  let two: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    one = await seedTenant(db.appPool, 'Customer One');
    two = await seedTenant(db.appPool, 'Customer Two');
    await preparePricedTenant(db, one.tenantId, { packageCode: 'PAYG' });
    await preparePricedTenant(db, two.tenantId, { packageCode: 'ESSENTIAL' });

    for (const tenant of [one, two]) {
      await withTenant(db.appPool, tenant.tenantId, (tx) =>
        verify(tx, {
          productCode: 'ADDRESS_ONLY',
          subject: { unn: '7001272184' },
          subjectIdentifiers: [{ idType: 'UNN', value: '7001272184' }],
          idempotencyKey: randomUUID(),
          triggeredBy: 'API',
          modeAtExecution: 'BYOC',
          runStep: fixture.runnerFor(tx),
          keys,
        }),
      );
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('totals what each customer earned us, per service', async () => {
    const rows = await marginReport(db.operatorPool);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const names = rows.map((row) => row.tenantName).sort();
    expect(names).toContain('Customer One');
    expect(names).toContain('Customer Two');
    for (const row of rows) {
      expect(row.runs).toBeGreaterThan(0);
      expect(row.productCode).toBe('ADDRESS_ONLY');
    }
  });

  it('shows work the package covered as earning nothing this month', async () => {
    const rows = await marginReport(db.operatorPool, { tenantId: two.tenantId });
    const row = rows[0];

    // The essential plan sells capacity, so this run was bought when the commitment was
    // signed. A margin report that hid that would overstate the month.
    expect(row?.packageRuns).toBe(1);
    expect(row?.billedHalalas).toBe(0);
    // And a margin on no revenue is undefined rather than zero, so nobody averages it.
    expect(row?.marginPct).toBeNull();
  });

  it('computes the margin where there is revenue', async () => {
    const rows = await marginReport(db.operatorPool, { tenantId: one.tenantId });
    const row = rows[0];
    expect(row?.billedHalalas).toBeGreaterThan(0);
    expect(row?.grossHalalas).toBe((row?.billedHalalas ?? 0) - (row?.providerCostHalalas ?? 0));
    expect(row?.marginPct).not.toBeNull();
  });

  it('carries nothing about who was verified', async () => {
    const rows = await marginReport(db.operatorPool);
    const serialised = JSON.stringify(rows);

    // The row is a count and two sums. It cannot answer anything else, which is what
    // makes it safe to read across subscribers.
    expect(serialised).not.toContain('7001272184');
    expect(serialised).not.toContain('entity');
    expect(serialised).not.toContain('decision');
  });

  it('refuses the operator the table the numbers came from', async () => {
    // The counters are readable; the runs behind them are not, and that is the guarantee
    // this whole shape exists to keep.
    await expect(db.operatorPool.query('SELECT count(*) FROM verification_runs')).rejects.toThrow(
      /permission denied/,
    );
  });
});
