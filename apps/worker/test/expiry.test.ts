import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { addChannel, subscribe } from '../../../packages/core/src/notifications/notifications.js';
import {
  createTestDatabase,
  seedEntity,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { announceExpiries } from '../src/jobs/expiry.js';

/**
 * Telling somebody that a fact has gone out of date.
 *
 * Freshness is arithmetic, so nothing wrote it and nothing announced it: the event type
 * existed, the message was written, a subscriber could subscribe on the notifications screen,
 * and they would never have heard from it.
 *
 * The crossing is announced, not the state. What is proven here is that a field which expired
 * within the window is announced once, that one which expired long ago is not announced again,
 * and that a field still fresh is not announced at all.
 */

describe('announcing an expiry', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let entityId = '';

  const write = async (fieldPath: string, observedAt: Date, ttlDays: number): Promise<void> => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO freshness_policy (tenant_id, field_path, ttl_days)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [tenant.tenantId, fieldPath, ttlDays],
      );
      await tx.query(
        `INSERT INTO attestations
           (tenant_id, entity_id, field_path, value, value_hash, source, authority, run_id,
            observed_at, valid_from)
         VALUES ($1, $2, $3, $4::jsonb, decode(md5($3), 'hex'), 'stub', 'الجهة',
                 gen_random_uuid(), $5, $5)`,
        [tenant.tenantId, entityId, fieldPath, JSON.stringify('value'), observedAt],
      );
    });
  };

  const announced = async (sinceHours = 24): Promise<number> =>
    (await withTenant(db.appPool, tenant.tenantId, (tx) => announceExpiries(tx, { sinceHours })))
      .announced;

  const deliveries = async (): Promise<number> =>
    Number(
      (
        await withTenant(db.appPool, tenant.tenantId, (tx) =>
          tx.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM notification_deliveries
             WHERE tenant_id = $1 AND event_type = 'attestation.expired'`,
            [tenant.tenantId],
          ),
        )
      ).rows[0]?.count ?? '0',
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Expiry Tenant');
    entityId = await seedEntity(db.appPool, tenant.tenantId, 'BUSINESS', 'شركة التجربة');

    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const channelId = await addChannel(tx, { address: 'alerts@expiry.sa', verified: true });
      await subscribe(tx, { channelId, eventType: 'attestation.expired' });
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('says nothing about a fact that is still fresh', async () => {
    await write('fresh.field', new Date(), 30);
    expect(await announced()).toBe(0);
    expect(await deliveries()).toBe(0);
  });

  it('announces a fact that went out of date inside the window', async () => {
    // Observed thirty days and a half ago with a thirty day life: it crossed twelve hours ago,
    // which is inside the window and not on its edge. A fixture on the edge is a flaky test.
    const observed = new Date(Date.now() - (30 * 24 + 12) * 60 * 60 * 1000);
    await write('recent.field', observed, 30);
    expect(await announced()).toBe(1);
    expect(await deliveries()).toBe(1);
  });

  it('does not announce the same expiry again the next day', async () => {
    // The same rows, a window that no longer reaches back to the crossing.
    expect(await announced(1)).toBe(0);
    expect(await deliveries()).toBe(1);
  });

  it('says nothing about a fact that went out of date long ago', async () => {
    const observed = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    await write('old.field', observed, 30);
    expect(await announced(1)).toBe(0);
  });

  it('is a job the worker actually runs', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    expect(source).toContain('announceExpiries');
    expect(source).toMatch(/name: 'expiry-alerts'/);
  });

  it('warns at startup when nothing can send a notification', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    // Said once and loudly, like the retention warning. A queue that grows in silence is
    // worse than one that fails.
    expect(source).toContain('no mail is configured in the environment');
  });

  it('registers the delivery job whether or not the environment configures mail', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    // It used to exist only when an environment variable did, which meant mail configured
    // from the panel delivered nothing until somebody restarted the worker (ADR-141).
    expect(source).toMatch(/name: 'notifications'/);
    expect(source).not.toMatch(/if \(mail\) \{/);
    expect(source).toContain('getMailSettings');
  });
});
