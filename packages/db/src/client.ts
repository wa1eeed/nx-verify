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

export function createPool(connectionString: string): pg.Pool {
  return new Pool({ connectionString });
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
      query: (text, values) => client.query(text, values as unknown[] | undefined),
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
      query: (text, values) => client.query(text, values as unknown[] | undefined),
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
