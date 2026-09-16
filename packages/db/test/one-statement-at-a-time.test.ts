import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../src/client.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';

/**
 * One connection executes one statement at a time.
 *
 * Several screens gather the facts of a page with `Promise.all`, which is the right shape for
 * the caller and the wrong shape for one connection: `pg` warns when a second statement is
 * asked for while the first is running, and from pg 9 it refuses. The queue lives in the
 * transaction helper rather than in every caller, so a caller cannot get this wrong.
 *
 * What is proven here is that concurrent callers still get their own answers, in order, and
 * that a statement which fails does not poison the ones after it.
 */

describe('a transaction runs one statement at a time', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Serial Tenant');
  });

  afterAll(async () => {
    await db.close();
  });

  it('answers every concurrent query, each with its own result', async () => {
    const answers = await withTenant(db.appPool, tenant.tenantId, async (tx) =>
      Promise.all(
        [1, 2, 3, 4, 5, 6, 7, 8].map((value) =>
          tx.query<{ value: number }>('SELECT $1::int AS value', [value]),
        ),
      ),
    );
    expect(answers.map((answer) => answer.rows[0]?.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('runs them in the order they were asked for', async () => {
    const order = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const started: number[] = [];
      await Promise.all(
        [1, 2, 3, 4].map(async (value) => {
          // A statement that takes a moment: without a queue the later ones would start
          // before this one finished, which is exactly what pg refuses.
          await tx.query('SELECT pg_sleep($1)', [value === 1 ? 0.05 : 0]);
          started.push(value);
        }),
      );
      return started;
    });
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('lets a failure fail on its own without poisoning the next statement', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await expect(tx.query('SELECT 1 FROM no_such_table')).rejects.toThrow();
      // The transaction is aborted now, and the next statement says so rather than hanging
      // behind a queue that never drains.
      await expect(tx.query('SELECT 1')).rejects.toThrow();
    }).catch(() => undefined);
  });

  it('does the same outside a tenant', async () => {
    const answers = await withoutTenant(db.appPool, async (tx) =>
      Promise.all(
        [10, 20, 30].map((value) =>
          tx.query<{ value: number }>('SELECT $1::int AS value', [value]),
        ),
      ),
    );
    expect(answers.map((answer) => answer.rows[0]?.value)).toEqual([10, 20, 30]);
  });
});
