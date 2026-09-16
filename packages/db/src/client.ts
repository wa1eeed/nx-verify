import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assertUuid } from './sql-identifier.js';
import * as schema from './schema/index.js';

const { Pool } = pg;

export type Pool = pg.Pool;
export type QueryResultRow = pg.QueryResultRow;

/**
 * The only way this codebase reaches tenant scoped data.
 *
 * Rule 2 and rule 3: no query crosses tenants, and row level security is the layer that
 * enforces it. `app.tenant_id` is set with is_local = true, so the setting is bound to
 * the transaction and dies with it. A pooled connection handed to the next request
 * therefore carries no leftover tenant context.
 */

export interface TenantTransaction {
  readonly tenantId: string;
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
  readonly db: NodePgDatabase<typeof schema>;
}

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

/**
 * Runs a handler inside a savepoint.
 *
 * A statement that raises aborts the entire transaction in PostgreSQL, so any code that
 * means to catch a constraint violation and carry on must set a savepoint first.
 * Without it the recovery path runs against an aborted transaction and fails with 25P02,
 * masking the original error.
 */
export async function withSavepoint<T>(tx: Queryable, handler: () => Promise<T>): Promise<T> {
  const name = `nx_sp_${randomBytes(8).toString('hex')}`;
  await tx.query(`SAVEPOINT ${name}`);
  try {
    const result = await handler();
    await tx.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await tx.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw error;
  }
}

export function createPool(connectionString: string): pg.Pool {
  return new Pool({ connectionString });
}

/**
 * One statement at a time on one connection.
 *
 * A connection executes one statement at a time. Ask it for a second while the first is still
 * running and `pg` warns, and from pg 9 it refuses. Several screens legitimately gather the
 * facts of a page with `Promise.all`, which is the right shape for the caller and the wrong
 * shape for one connection.
 *
 * So the queue lives here, once, rather than in every caller: statements run in the order they
 * were issued, and a caller that writes `Promise.all` gets the answer it expects. Nothing is
 * lost by it, because those queries were never actually running at the same time.
 *
 * A failed statement does not poison the queue. The next one runs and fails on its own, which
 * is what an aborted transaction should do, rather than being swallowed here.
 */
export function serialisedQuery(
  client: pg.PoolClient,
): <R extends pg.QueryResultRow>(
  text: string,
  values?: readonly unknown[],
) => Promise<pg.QueryResult<R>> {
  let queue: Promise<unknown> = Promise.resolve();
  return <R extends pg.QueryResultRow>(text: string, values?: readonly unknown[]) => {
    const result = queue.then(() => client.query<R>(text, values as unknown[] | undefined));
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export async function withTenant<T>(
  pool: pg.Pool,
  tenantId: string,
  handler: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  assertUuid(tenantId, 'tenantId');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

    const tx: TenantTransaction = {
      tenantId,
      query: serialisedQuery(client),
      db: drizzle(client, { schema }),
    };

    const result = await handler(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A transaction with no tenant in scope. Every policy denies, so this can only reach
 * tables that are not tenant scoped. It exists so that operational code has to say out
 * loud that it is running without a tenant.
 */
export async function withoutTenant<T>(
  pool: pg.Pool,
  handler: (tx: Omit<TenantTransaction, 'tenantId'>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await handler({
      query: serialisedQuery(client),
      db: drizzle(client, { schema }),
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
