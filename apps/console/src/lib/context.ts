import { createPool, withTenant, type TenantTransaction } from '@nx-verify/db';
import {
  capabilitiesOf,
  resolveCapabilities,
  type Capability,
  type UserRole,
} from '@nx-verify/core';
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
  const session = await requireSession();
  return session.tenantId;
}

export async function query<T>(handler: (tx: TenantTransaction) => Promise<T>): Promise<T> {
  const session = await requireSession();
  return withTenant(getPool(), session.tenantId, handler);
}

export interface Actor extends ConsoleSession {
  capabilities: ReadonlySet<Capability>;
  /** What this person may do, asked the way a screen wants to ask it. */
  can: (capability: Capability) => boolean;
}

/**
 * The caller, and what they may do.
 *
 * Every screen asks this, and the answer comes from `app.user_capabilities` rather than
 * from the role on the session: the same function the four eyes trigger reads. A screen
 * that decided for itself from the role would eventually show a button the database
 * refuses, which is worse than either answer alone.
 *
 * A screen calls `can` to hide what this person has no business seeing, and the action
 * behind it calls `assertCan` regardless, because hiding a button is a courtesy and not a
 * control: the form still posts.
 */
export async function actingUser(): Promise<Actor> {
  const session = await requireSession();

  // The development fallback invents a user who is in no table, so asking the database
  // what they may do returns nothing and every screen goes blank. It already refuses to
  // work in production, so here it simply carries the role it was given.
  const capabilities = session.development
    ? resolveCapabilities(session.role as UserRole)
    : await withTenant(getPool(), session.tenantId, (tx) => capabilitiesOf(tx, session.userId));

  return {
    ...session,
    capabilities,
    can: (capability: Capability) => capabilities.has(capability),
  };
}

/**
 * A session, or the sign in screen.
 *
 * A page that cannot say who is looking at it must not render, and it must not show an
 * error either: there is nothing on it yet, and the person simply needs to sign in. The
 * redirect is what makes every screen private without every screen remembering to be.
 */
async function requireSession(): Promise<ConsoleSession> {
  let session: ConsoleSession;
  try {
    session = await currentSession();
  } catch {
    const { redirect } = await import('next/navigation');
    // redirect throws, so nothing after it runs. TypeScript needs to be told.
    return redirect('/login') as never;
  }

  // A temporary password that is never actually changed is a permanent password that
  // somebody once wrote down. The screen that changes it reads the session directly, so
  // this redirect cannot loop through it.
  if (!session.development && (await mustChangePassword(session))) {
    const { redirect } = await import('next/navigation');
    return redirect('/password') as never;
  }

  return session;
}

async function mustChangePassword(session: ConsoleSession): Promise<boolean> {
  const { rows } = await withTenant(getPool(), session.tenantId, (tx) =>
    tx.query<{ must_change: boolean }>(
      `SELECT must_change FROM user_credentials WHERE tenant_id = $1 AND user_id = $2`,
      [tx.tenantId, session.userId],
    ),
  );
  return rows[0]?.must_change ?? false;
}

/**
 * The session without the password check.
 *
 * Used by the screen that changes the password, and by nothing else: every other screen
 * must go through requireSession.
 */
export async function sessionForPasswordChange(): Promise<ConsoleSession> {
  try {
    return await currentSession();
  } catch {
    const { redirect } = await import('next/navigation');
    return redirect('/login') as never;
  }
}

/** Releases the pool. Used on shutdown and by tests. */
export async function closePool(): Promise<void> {
  if (pool) {
    const closing = pool;
    pool = undefined;
    await closing.end();
  }
}
