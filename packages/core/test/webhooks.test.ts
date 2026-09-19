import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  endpointHealth,
  listDeliveries,
  queueEvent,
  registerEndpoint,
} from '../src/webhooks/dispatch.js';
import { createTestDatabase, seedTenant, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * Whether a webhook is actually arriving (ADR-169).
 *
 * `webhook_deliveries` recorded every attempt, its status, how many tries it took and the HTTP
 * code that came back, and NOTHING EVER READ IT. So a subscriber registered an address and was
 * blind to whether one event had ever landed: we give up after the retries and record that we
 * gave up, the integration on the other end simply goes quiet, and somebody notices weeks
 * later when a customer asks why an alert never came.
 */

describe('how an endpoint is doing', () => {
  let db: TestDatabase;
  let tenantId: string;
  let endpointId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    const tenant = await seedTenant(db.appPool, 'شركة الإشعارات');
    tenantId = tenant.tenantId;
    endpointId = await withTenant(db.appPool, tenantId, (tx) =>
      registerEndpoint(tx, {
        url: 'https://api.example.sa/nx-hooks',
        secretRef: 'kms://tenants/test/webhook',
        events: ['verification.completed'],
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  const scope = <T>(handler: Parameters<typeof withTenant<T>>[2]): Promise<T> =>
    withTenant(db.appPool, tenantId, handler);

  it('reports nothing for an address that has been sent nothing', async () => {
    expect(await scope((tx) => endpointHealth(tx))).toEqual([]);
  });

  it('counts what arrived, what is still trying, and what was given up on', async () => {
    await scope(async (tx) => {
      for (let index = 0; index < 4; index += 1) {
        await queueEvent(tx, { eventType: 'verification.completed', payload: { n: index } });
      }
      // The worker writes these states; this stands in for four different outcomes.
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM webhook_deliveries WHERE tenant_id = $1 ORDER BY created_at`,
        [tx.tenantId],
      );
      const ids = rows.map((row) => row.id);
      await tx.query(
        `UPDATE webhook_deliveries SET status = 'delivered', delivered_at = now(),
                last_status = 200, attempts = 1
          WHERE tenant_id = $1 AND id = ANY($2)`,
        [tx.tenantId, [ids[0], ids[1]]],
      );
      await tx.query(
        `UPDATE webhook_deliveries SET status = 'failed', last_status = 502, attempts = 2
          WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, ids[2]],
      );
      await tx.query(
        `UPDATE webhook_deliveries SET status = 'abandoned', last_status = 500, attempts = 6
          WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, ids[3]],
      );
    });

    const health = (await scope((tx) => endpointHealth(tx)))[0];
    expect(health?.delivered).toBe(2);
    expect(health?.failing).toBe(1);
    // Named apart from failing on purpose: a failing delivery is still being retried, an
    // abandoned one is past the schedule and never coming back by itself.
    expect(health?.abandoned).toBe(1);
    expect(health?.lastDeliveredAt).not.toBeNull();
  });

  it('never returns the payload, because this answers «did it arrive» and not «what was in it»', async () => {
    const deliveries = await scope((tx) => listDeliveries(tx, { endpointId }));
    expect(deliveries.length).toBeGreaterThan(0);
    // A screen showing the body of every event is a second copy of the customer data, in a
    // place nobody thought of as customer data.
    for (const delivery of deliveries) {
      expect(Object.keys(delivery)).not.toContain('payload');
    }
    // Newest first, which is the order somebody debugging reads in.
    const times = deliveries.map((row) => row.createdAt.getTime());
    expect([...times].sort((left, right) => right - left)).toEqual(times);
  });

  it('shows another workspace nothing of this one', async () => {
    const other = await seedTenant(db.appPool, 'شركة أخرى');
    const seen = await withTenant(db.appPool, other.tenantId, (tx) => listDeliveries(tx));
    expect(seen).toEqual([]);
  });
});
