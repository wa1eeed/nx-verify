import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { recordApiRequest } from '../src/observability/api-log.js';
import { subscriberHealth } from '../src/observability/service-health.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant } from '../../../test/helpers/billing.js';

/**
 * Unit 53 acceptance: support can answer the telephone.
 *
 * The three questions, and the boundary that still holds while they are answered: staff
 * see what our own service did and what the customer's balance is, and nothing about whom
 * that customer verified.
 */

describe('service health across subscribers', () => {
  let db: TestDatabase;
  let healthy: SeededTenant;
  let struggling: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    healthy = await seedTenant(db.appPool, 'Healthy Customer');
    struggling = await seedTenant(db.appPool, 'Struggling Customer');
    await preparePricedTenant(db, healthy.tenantId);
    await preparePricedTenant(db, struggling.tenantId);

    await withTenant(db.appPool, healthy.tenantId, (tx) =>
      recordApiRequest(tx, {
        apiKeyId: null,
        requestId: 'req_ok',
        method: 'POST',
        route: '/v1/verifications',
        status: 201,
        latencyMs: 20,
        environment: 'live',
      }),
    );

    await withTenant(db.appPool, struggling.tenantId, async (tx) => {
      for (const status of [403, 500, 201]) {
        await recordApiRequest(tx, {
          apiKeyId: null,
          requestId: `req_${status}`,
          method: 'POST',
          route: '/v1/verifications',
          status,
          latencyMs: status === 500 ? 900 : 15,
          errorCode: status >= 400 ? 'NX-4031' : null,
          environment: 'live',
        });
      }
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('puts the subscriber in trouble first', async () => {
    const rows = await subscriberHealth(db.operatorPool);
    const first = rows[0];

    expect(first?.legalName).toBe('Struggling Customer');
    expect(first?.failures).toBe(2);
    expect(first?.calls).toBe(3);
    expect(first?.slowestMs).toBe(900);
  });

  it('answers the balance question in the same terms the subscriber sees', async () => {
    const rows = await subscriberHealth(db.operatorPool);
    for (const row of rows) {
      expect(row.balanceHalalas).toBeGreaterThan(0);
      // Funded fixtures are not low, and the rule is the wallet's own so the two screens
      // can never disagree.
      expect(row.balanceLow).toBe(false);
    }
  });

  it('carries the available balance already worked out, rather than leaving the screen to subtract', async () => {
    // «الرصيد المتاح» was defined twice: here, where `balanceLow` is decided, and again in
    // the markup of the operator screen. Held money is the whole difference between them, so
    // a later change to what a hold means would have reached the tag and not the figure it
    // sits beside (ADR-181).
    const held = 12_345;
    // On the subscriber's own connection: the operator role holds no write on wallets, which
    // is itself why the two definitions could drift without either screen noticing.
    const hold = (amount: number): Promise<unknown> =>
      withTenant(db.appPool, struggling.tenantId, (tx) =>
        tx.query(`UPDATE wallets SET held = $2 WHERE tenant_id = $1`, [tx.tenantId, amount]),
      );

    await hold(held);
    const row = (await subscriberHealth(db.operatorPool)).find(
      (candidate) => candidate.tenantId === struggling.tenantId,
    );
    expect(row?.heldHalalas).toBe(held);
    expect(row?.walletAvailableHalalas).toBe((row?.balanceHalalas ?? 0) - held);
    await hold(0);
  });

  it('says nothing about whom anybody verified', async () => {
    const rows = await subscriberHealth(db.operatorPool);
    const serialised = JSON.stringify(rows);

    expect(serialised).not.toContain('entity');
    expect(serialised).not.toContain('decision');
    expect(serialised).not.toContain('7001272184');
  });

  it('still refuses the operator the tables that say what a subscriber knows', async () => {
    // The line moved once, deliberately, and only that far.
    await expect(db.operatorPool.query('SELECT count(*) FROM attestations')).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.operatorPool.query('SELECT count(*) FROM entities')).rejects.toThrow(
      /permission denied/,
    );
  });
});
