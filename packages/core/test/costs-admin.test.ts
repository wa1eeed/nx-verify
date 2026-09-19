import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withoutTenant } from '../../../packages/db/src/client.js';
import { applyProductSeed } from '../../../packages/db/src/seed/products.js';
import { applyCostSeed } from '../../../packages/db/src/seed/costs.js';
import { applyDefaultPriceSeed } from '../../../packages/db/src/seed/default-prices.js';
import {
  listProviderCosts,
  listUnpricedCalls,
  setProviderCost,
} from '../src/billing/costs-admin.js';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';
import type { OperatorIdentity } from '../src/operators/accounts.js';

/**
 * What a provider call costs us, recorded from the panel (ADR-166).
 *
 * Every margin the platform shows is arithmetic on this table, and the panel could only read
 * it: the rates came from a seed file, so the margin was correct for exactly as long as that
 * file matched the contract.
 */

const OWNER: OperatorIdentity = { id: 'op-1', displayName: 'مالك', role: 'OWNER' };
const SUPPORT: OperatorIdentity = { id: 'op-2', displayName: 'دعم', role: 'SUPPORT' };

describe('recording what a provider charges', () => {
  let db: TestDatabase;
  let call: { provider: string; endpoint: string };

  beforeAll(async () => {
    db = await createTestDatabase();
    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx, undefined, {}));
    await withoutTenant(db.appPool, (tx) => applyCostSeed(tx));
    // The list prices, because "which prices did this rate put under water" has nothing to
    // compare against without them. On the owner connection, which is the only role the price
    // book lets write a row with no tenant, exactly as the provisioner does it.
    await applyDefaultPriceSeed(db.migratorPool);
    // A call the catalogue actually makes. The seeded cost book also carries rates for calls
    // no product makes, which is itself worth knowing and is asserted below.
    const used = (await listProviderCosts(db.operatorPool)).find((cost) => cost.usedByProducts > 0);
    call = { provider: used?.provider ?? '', endpoint: used?.endpoint ?? '' };
  });

  afterAll(async () => {
    await db.close();
  });

  it('lists every open cost with how many products it touches', async () => {
    const costs = await listProviderCosts(db.operatorPool);
    expect(costs.length).toBeGreaterThan(0);
    // The blast radius of a rate change, which is what makes this screen safe to act on.
    expect(costs.some((cost) => cost.usedByProducts > 0)).toBe(true);
    for (const cost of costs) {
      expect(cost.billedHalalas).toBeGreaterThanOrEqual(0);
    }
  });

  it('shows a cost no product reads as touching nothing', async () => {
    // The seeded book carries rates for calls the catalogue no longer makes. Not an error to
    // hold them, but a figure somebody will one day reconcile against an invoice and not find,
    // so the screen says «0 منتج» rather than leaving it to be assumed.
    const orphaned = (await listProviderCosts(db.operatorPool)).filter(
      (cost) => cost.usedByProducts === 0,
    );
    for (const cost of orphaned) {
      expect(cost.endpoint).toBeTruthy();
    }
  });

  it('counts the provider tax as ours while the platform is unregistered', async () => {
    const costs = await listProviderCosts(db.operatorPool);
    const taxed = costs.find((cost) => cost.vatBps > 0);
    // Not registered, so their tax is not reclaimable and the cost is the whole bill.
    expect(taxed?.effectiveHalalas).toBe(taxed?.billedHalalas);
  });

  it('closes the old rate rather than editing it, so a past month stays measurable', async () => {
    const before = (await listProviderCosts(db.operatorPool)).find(
      (cost) => cost.provider === call.provider && cost.endpoint === call.endpoint,
    );
    await setProviderCost(db.operatorPool, OWNER, {
      ...call,
      billedHalalas: (before?.billedHalalas ?? 0) + 250,
      vatBps: 1500,
    });

    const { rows } = await db.operatorPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM cost_book
        WHERE provider = $1 AND endpoint = $2`,
      [call.provider, call.endpoint],
    );
    expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(2);

    const open = (await listProviderCosts(db.operatorPool)).filter(
      (cost) => cost.provider === call.provider && cost.endpoint === call.endpoint,
    );
    // Exactly one open row, which every reader already takes on faith.
    expect(open).toHaveLength(1);
    expect(open[0]?.billedHalalas).toBe((before?.billedHalalas ?? 0) + 250);
  });

  it('writes no second row when the rate has not moved', async () => {
    const current = (await listProviderCosts(db.operatorPool)).find(
      (cost) => cost.provider === call.provider && cost.endpoint === call.endpoint,
    );
    const count = async () => {
      const { rows } = await db.operatorPool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM cost_book WHERE provider = $1 AND endpoint = $2`,
        [call.provider, call.endpoint],
      );
      return Number(rows[0]?.count);
    };
    const before = await count();
    await setProviderCost(db.operatorPool, OWNER, {
      ...call,
      billedHalalas: current?.billedHalalas ?? 0,
      vatBps: current?.vatBps ?? 1500,
    });
    // A history of somebody pressing save is not a history of costs.
    expect(await count()).toBe(before);
  });

  it('names the prices a rate increase put under water, and records it anyway', async () => {
    // A provider raising their price is not our decision, and refusing to write it down leaves
    // the platform quoting a margin that no longer exists.
    const change = await setProviderCost(db.operatorPool, OWNER, {
      ...call,
      billedHalalas: 900_00,
      vatBps: 1500,
    });
    expect(change.toHalalas).toBe(900_00);
    expect(change.nowUnderCost.length).toBeGreaterThan(0);
    for (const broken of change.nowUnderCost) {
      expect(broken.priceHalalas).toBeLessThan(broken.costHalalas);
      expect(broken.nameAr).toBeTruthy();
    }
  });

  it('refuses a cost for a call no product makes', async () => {
    // A typo in an endpoint name is how a row nothing will ever read gets created.
    await expect(
      setProviderCost(db.operatorPool, OWNER, {
        provider: call.provider,
        endpoint: 'corporate_typo',
        billedHalalas: 100,
        vatBps: 1500,
      }),
    ).rejects.toMatchObject({ code: 'NX-4041' });
  });

  it('lets only the roles that set prices set costs', async () => {
    await expect(
      setProviderCost(db.operatorPool, SUPPORT, { ...call, billedHalalas: 100, vatBps: 1500 }),
    ).rejects.toMatchObject({ code: 'NX-4031' });
  });

  it('finds calls the catalogue makes with no cost recorded', async () => {
    await db.operatorPool.query(
      `UPDATE cost_book SET valid_to = now() WHERE provider = $1 AND endpoint = $2`,
      [call.provider, call.endpoint],
    );
    const unpriced = await listUnpricedCalls(db.operatorPool);
    const found = unpriced.find(
      (row) => row.provider === call.provider && row.endpoint === call.endpoint,
    );
    // A product whose cost is unknown has a margin the platform is inventing.
    expect(found).toBeDefined();
    expect(found?.usedByProducts).toBeGreaterThan(0);
  });
});
