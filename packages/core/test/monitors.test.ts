import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { applyProductSeed } from '../../../packages/db/src/seed/products.js';
import { readAudit } from '../src/auth/audit.js';
import {
  createMonitor,
  listMonitors,
  pauseMonitor,
  recordMonitorSpend,
  setMonitorBudget,
  type MonitorRow,
} from '../src/monitoring/monitors.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';

/**
 * The ceiling, and the monitor that lived or died by it.
 *
 * A monitor that reached its cap set itself to budget_exhausted, `resumeMonitor` refuses an
 * exhausted one by design, and no code anywhere could change a cap. Paid monitoring on a
 * customer therefore ended for good the first time it did what it was told, while every
 * screen advised raising a ceiling that nothing could raise.
 *
 * What is proven here is that the ceiling is now the control it was always described as, and
 * that it only revives a monitor when there is actually money left under it.
 */

const OPERATOR = 'user:risk-lead';

describe('the ceiling of a monitor', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let other: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    // The product a monitor re-runs is a row, not a constant (rule 8), so the catalogue is
    // seeded before anything can point at one.
    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx));
    tenant = await seedTenant(db.appPool, 'Monitored Tenant');
    other = await seedTenant(db.appPool, 'Another Tenant');
  });

  afterAll(async () => {
    await db.close();
  });

  /** A monitor with `cap` halalas for the month, of which `spent` is already gone. */
  async function monitorSpending(cap: number, spent: number): Promise<string> {
    return withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const monitorId = await createMonitor(tx, {
        entityId: tenant.entityId,
        productCode: 'KYB_COMPLETE',
        fieldPaths: ['cr.status'],
        cadence: 'MONTHLY',
        budgetCapPerPeriod: cap,
        activatedBy: OPERATOR,
      });
      if (spent > 0) {
        await recordMonitorSpend(tx, monitorId, spent);
      }
      return monitorId;
    });
  }

  async function rowOf(monitorId: string): Promise<MonitorRow> {
    const rows = await withTenant(db.appPool, tenant.tenantId, (tx) => listMonitors(tx));
    const row = rows.find((candidate) => candidate.id === monitorId);
    if (!row) {
      throw new Error('the monitor under test is not in the list');
    }
    return row;
  }

  it('starts watching again when the new ceiling is above what the month has spent', async () => {
    const monitorId = await monitorSpending(100_00, 100_00);
    expect((await rowOf(monitorId)).status).toBe('budget_exhausted');

    const change = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      setMonitorBudget(tx, {
        monitorId,
        budgetCapPerPeriod: 300_00,
        changedBy: OPERATOR,
      }),
    );

    expect(change).toMatchObject({ resumed: true, status: 'active', budgetCap: 300_00 });

    // Due now rather than next month: a monitor revived on the strength of a new ceiling and
    // then left sitting until its old schedule comes round has not been revived.
    const row = await rowOf(monitorId);
    expect(row.status).toBe('active');
    expect(row.budgetCap).toBe(300_00);
    expect(row.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('stays stopped when the new ceiling is not above what the month has spent', async () => {
    const monitorId = await monitorSpending(100_00, 100_00);

    const change = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      setMonitorBudget(tx, {
        monitorId,
        budgetCapPerPeriod: 100_00,
        changedBy: OPERATOR,
      }),
    );

    // Turning it green here would be a lie that lasts one sweep: there is nothing left under
    // the ceiling, so the next run would stop it again.
    expect(change).toMatchObject({ resumed: false, status: 'budget_exhausted' });
    expect((await rowOf(monitorId)).status).toBe('budget_exhausted');
  });

  it('stops an active monitor that is cut below what it has already spent', async () => {
    const monitorId = await monitorSpending(500_00, 200_00);
    expect((await rowOf(monitorId)).status).toBe('active');

    const change = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      setMonitorBudget(tx, {
        monitorId,
        budgetCapPerPeriod: 150_00,
        changedBy: OPERATOR,
      }),
    );

    expect(change).toMatchObject({ resumed: false, status: 'budget_exhausted' });
  });

  it('leaves a ceiling on a running monitor running, and does not call that a revival', async () => {
    const monitorId = await monitorSpending(100_00, 20_00);

    const change = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      setMonitorBudget(tx, {
        monitorId,
        budgetCapPerPeriod: 400_00,
        changedBy: OPERATOR,
      }),
    );

    expect(change).toMatchObject({ resumed: false, status: 'active', budgetCap: 400_00 });
  });

  it('does not restart a monitor a person stopped on purpose', async () => {
    const monitorId = await monitorSpending(100_00, 10_00);
    await withTenant(db.appPool, tenant.tenantId, (tx) => pauseMonitor(tx, monitorId));

    const change = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      setMonitorBudget(tx, {
        monitorId,
        budgetCapPerPeriod: 900_00,
        changedBy: OPERATOR,
      }),
    );

    expect(change).toMatchObject({ resumed: false, status: 'paused' });
  });

  it('writes the change to the audit trail, with the figure and where it left the monitor', async () => {
    const monitorId = await monitorSpending(100_00, 100_00);

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      setMonitorBudget(tx, {
        monitorId,
        budgetCapPerPeriod: 250_00,
        changedBy: OPERATOR,
      }),
    );

    const entries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      readAudit(tx, { action: 'monitor.budget_changed' }),
    );
    const entry = entries.find((candidate) => candidate.target === monitorId);

    expect(entry).toMatchObject({
      actorType: 'USER',
      actorId: OPERATOR,
      metadata: {
        budget_cap_halalas: 250_00,
        spent_this_period_halalas: 100_00,
        status: 'active',
      },
    });
  });

  it('refuses a ceiling of nothing, which is not a budget', async () => {
    const monitorId = await monitorSpending(100_00, 0);

    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        setMonitorBudget(tx, { monitorId, budgetCapPerPeriod: 0, changedBy: OPERATOR }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4001' });
  });

  it('cannot be moved from another workspace', async () => {
    const monitorId = await monitorSpending(100_00, 100_00);

    await expect(
      withTenant(db.appPool, other.tenantId, (tx) =>
        setMonitorBudget(tx, { monitorId, budgetCapPerPeriod: 900_00, changedBy: OPERATOR }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4041' });

    expect((await rowOf(monitorId)).status).toBe('budget_exhausted');
  });
});
