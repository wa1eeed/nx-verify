import { createPool, withTenant, type TenantTransaction } from '@nx-verify/db';
import { currentSession, type ConsoleSession } from './session';
import type pg from 'pg';

/**
 * The console's database access.
 *
 * One pool, and every read goes through withTenant. There is no query in this app that
 * runs without a tenant in scope, so rule 2 holds by construction rather than by review.
 *
 * The tenant comes from the session cookie, never from the URL, so a user cannot reach
 * another tenant by editing an address. See lib/session.ts.
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

export async function currentTenantId(): Promise<string> {
  const session = await currentSession();
  return session.tenantId;
}

export async function query<T>(handler: (tx: TenantTransaction) => Promise<T>): Promise<T> {
  const session = await currentSession();
  return withTenant(getPool(), session.tenantId, handler);
}

/** The caller, for screens that need to know what this person may do. */
export async function actingUser(): Promise<ConsoleSession> {
  return currentSession();
}

/** Releases the pool. Used on shutdown and by tests. */
export async function closePool(): Promise<void> {
  if (pool) {
    const closing = pool;
    pool = undefined;
    await closing.end();
  }
}
