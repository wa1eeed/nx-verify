import { createPool, withTenant, type TenantTransaction } from '@nx-verify/db';
import type pg from 'pg';

/**
 * The console's database access.
 *
 * One pool, and every read goes through withTenant. There is no query in this app that
 * runs without a tenant in scope, so rule 2 holds by construction rather than by review.
 *
 * The tenant comes from the session in a deployment. Until sessions exist it is read from
 * the environment, and that is stated plainly rather than hidden behind a default.
 */

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env['NX_APP_DATABASE_URL'];
    if (!connectionString) {
      throw new Error('NX_APP_DATABASE_URL is not set');
    }
    pool = createPool(connectionString);
  }
  return pool;
}

export function currentTenantId(): string {
  const tenantId = process.env['NX_CONSOLE_TENANT_ID'];
  if (!tenantId) {
    throw new Error('NX_CONSOLE_TENANT_ID is not set. Sessions replace this in deployment.');
  }
  return tenantId;
}

export function query<T>(handler: (tx: TenantTransaction) => Promise<T>): Promise<T> {
  return withTenant(getPool(), currentTenantId(), handler);
}

/** Releases the pool. Used on shutdown and by tests. */
export async function closePool(): Promise<void> {
  if (pool) {
    const closing = pool;
    pool = undefined;
    await closing.end();
  }
}
