import { createPool, withoutTenant } from '@nx-verify/db';
import { resolveSession, type ResolvedSession, type UserRole } from '@nx-verify/core';
import type pg from 'pg';

/**
 * Who is looking at this page, and which tenant they belong to.
 *
 * The tenant comes from the session cookie, never from a parameter in the request, so a
 * user cannot reach another tenant by editing a URL. Everything below flows from that one
 * resolved value, which is what makes rule 2 hold in the console the way it holds in the
 * API.
 *
 * There is a development fallback to environment variables, and it refuses to work when
 * NODE_ENV is production. A convenience that silently survives into a deployment is not a
 * convenience.
 *
 * In a built console the fallback is not merely refused, it is gone: Next replaces
 * NODE_ENV at build time, so the production branch is the only branch a built image has,
 * whatever the container's environment says at run time. Verified by running the image
 * with NODE_ENV=development and a tenant id set, and being sent to the sign in screen.
 */

export const SESSION_COOKIE = 'nx_session';

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env['NX_APP_DATABASE_URL'];
    if (!connectionString) {
      throw new Error('NX_APP_DATABASE_URL is not set');
    }
    pool = createPool(connectionString);
  }
  return pool;
}

export async function closeSessionPool(): Promise<void> {
  if (pool) {
    const closing = pool;
    pool = undefined;
    await closing.end();
  }
}

export interface ConsoleSession extends ResolvedSession {
  /** True when this came from the development fallback rather than a real session. */
  development: boolean;
}

/**
 * Resolves the caller.
 *
 * `next/headers` is imported lazily, because it only exists inside a request and this
 * module is also used by tests that render a page directly.
 */
export async function currentSession(): Promise<ConsoleSession> {
  const token = await readCookie();

  if (token) {
    const resolved = await withoutTenant(getPool(), (tx) => resolveSession(tx, token));
    if (!resolved) {
      throw new Error('the session is not valid');
    }
    return { ...resolved, development: false };
  }

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('no session cookie, and the development fallback is disabled in production');
  }

  const tenantId = process.env['NX_CONSOLE_TENANT_ID'];
  if (!tenantId) {
    throw new Error('no session, and NX_CONSOLE_TENANT_ID is not set for development');
  }

  return {
    tenantId,
    userId: process.env['NX_CONSOLE_USER_ID'] ?? '',
    role: (process.env['NX_CONSOLE_ROLE'] as UserRole | undefined) ?? 'ADMIN',
    displayName: 'مستخدم التطوير',
    development: true,
  };
}

async function readCookie(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers');
    const store = await cookies();
    return store.get(SESSION_COOKIE)?.value ?? null;
  } catch {
    // Outside a request. That is expected in tests and during a build.
    return null;
  }
}
