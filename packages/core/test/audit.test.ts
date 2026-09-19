import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { audit, readAudit } from '../src/auth/audit.js';
import { createTestDatabase, seedTenant, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * Reading a trail years later (ADR-169).
 *
 * `readAudit` took a limit and an action and nothing else, so the screen asked for the last two
 * hundred rows and showed them. A question about last quarter had no answer, and a truncated
 * list looked exactly like a complete one.
 */

describe('reading the trail', () => {
  let db: TestDatabase;
  let tenantId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    const tenant = await seedTenant(db.appPool, 'شركة السجل');
    tenantId = tenant.tenantId;

    await withTenant(db.appPool, tenantId, async (tx) => {
      for (let index = 0; index < 6; index += 1) {
        await audit(tx, {
          actorType: 'USER',
          actorId: 'u1',
          action: 'user.created',
          target: `t${index}`,
        });
      }
    });
    // Not backdated: nx_app holds no UPDATE on audit_log, and that refusal is the point of
    // the table. The window is exercised by asking for one that excludes today instead.
  });

  afterAll(async () => {
    await db.close();
  });

  const scope = <T>(handler: Parameters<typeof withTenant<T>>[2]): Promise<T> =>
    withTenant(db.appPool, tenantId, handler);

  it('answers a question about a window that has nothing in it', async () => {
    // «Nothing happened in that month» is an answer, and the screen could not give it: it
    // asked for the last two hundred rows and showed whatever came back (ADR-169).
    const lastYear = await scope((tx) =>
      readAudit(tx, {
        from: new Date(Date.parse('2020-01-01T00:00:00Z')),
        to: new Date(Date.parse('2020-02-01T00:00:00Z')),
      }),
    );
    expect(lastYear).toEqual([]);
  });

  it('includes everything inside a window that covers it', async () => {
    const within = await scope((tx) =>
      readAudit(tx, { from: new Date(Date.now() - 24 * 60 * 60 * 1000) }),
    );
    expect(within.length).toBeGreaterThanOrEqual(6);
  });

  it('pages by the moment of the oldest row, not by an offset', async () => {
    /*
     * An offset would skip or repeat rows, because the trail grows while somebody reads it.
     * And the cursor is the id, not the timestamp: `now()` is the transaction clock, so every
     * row one transaction writes shares a created_at and a verification writes several. A
     * timestamp cursor never advanced past them, which this test caught (ADR-169).
     */
    const first = await scope((tx) => readAudit(tx, { limit: 2 }));
    expect(first).toHaveLength(2);

    const next = await scope((tx) =>
      readAudit(tx, { limit: 2, before: first[first.length - 1]?.id ?? '' }),
    );
    expect(next).toHaveLength(2);
    // No overlap: the cursor is exclusive.
    const seen = new Set(first.map((row) => row.id));
    expect(next.every((row) => !seen.has(row.id))).toBe(true);
  });

  it('keeps the action filter alongside the window', async () => {
    const found = await scope((tx) =>
      readAudit(tx, { action: 'user.created', from: new Date(Date.now() - 24 * 60 * 60 * 1000) }),
    );
    expect(found.length).toBeGreaterThanOrEqual(6);
    expect(found.every((row) => row.action === 'user.created')).toBe(true);

    // And the two narrow together rather than one winning.
    const none = await scope((tx) =>
      readAudit(tx, {
        action: 'user.created',
        from: new Date(Date.parse('2020-01-01T00:00:00Z')),
        to: new Date(Date.parse('2020-02-01T00:00:00Z')),
      }),
    );
    expect(none).toEqual([]);
  });

  it('refuses to be asked for the whole table at once', async () => {
    // A screen that can ask for everything will, and a trail is the table that grows fastest.
    const capped = await scope((tx) => readAudit(tx, { limit: 100_000 }));
    expect(capped.length).toBeLessThanOrEqual(500);
  });
});
