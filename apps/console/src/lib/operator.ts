import { createHmac } from 'node:crypto';
import { createPool, type Queryable } from '@nx-verify/db';
import type pg from 'pg';

/**
 * The operator surface.
 *
 * Kept apart from everything a subscriber can reach, and for one reason: rule 5. A
 * customer must never learn which provider serves them, and the only way to be sure of
 * that is for the screens that name providers to be unreachable from a customer session.
 *
 * So this uses its own connection, as its own database role, behind its own token. It
 * shares no session, no pool and no page with the tenant console. A bug in a tenant
 * screen cannot reach a provider name, because the code that reads them cannot run
 * without an operator token and an operator connection.
 */

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env['NX_OPERATOR_DATABASE_URL'];
    if (!connectionString) {
      throw new Error('NX_OPERATOR_DATABASE_URL is not set');
    }
    pool = createPool(connectionString);
  }
  return pool;
}

export async function closeOperatorPool(): Promise<void> {
  if (pool) {
    const closing = pool;
    pool = undefined;
    await closing.end();
  }
}

export const OPERATOR_COOKIE = 'nx_operator';

/** How long a sign in to the panel lasts before the token is asked for again. */
export const OPERATOR_SESSION_HOURS = 8;

const SESSION_LABEL = 'nx-operator-session/v1';

/** Whether this deployment has a panel at all. Without a token nobody can sign in. */
export function operatorPanelEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const token = env['NX_OPERATOR_TOKEN'];
  return token !== undefined && token.length >= 24;
}

/**
 * The cookie value for a signed in operator.
 *
 * Derived from the token and never the token itself. A browser holding the raw token
 * holds something that works for ever and from anywhere; this holds a value that stops
 * working at its expiry, and every one of them stops working the moment the token is
 * rotated, which is what signing everybody out needs to mean.
 */
export function operatorSessionValue(token: string, expiresAtMs: number): string {
  const mac = createHmac('sha256', token)
    .update(`${SESSION_LABEL}|${expiresAtMs}`)
    .digest('base64url');
  return `v1.${expiresAtMs}.${mac}`;
}

export function verifyOperatorSession(
  token: string,
  value: string,
  nowMs: number = Date.now(),
): boolean {
  const [version, expires, mac] = value.split('.');
  if (version !== 'v1' || !expires || !mac) {
    return false;
  }
  const expiresAt = Number(expires);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowMs) {
    return false;
  }
  // A value claiming to last longer than any sign in can was not issued by us.
  if (expiresAt - nowMs > OPERATOR_SESSION_HOURS * 3_600_000 + 60_000) {
    return false;
  }
  return timingSafeEquals(value, operatorSessionValue(token, expiresAt));
}

/** Compares a presented token with the configured one, in constant time. */
export function operatorTokenMatches(
  presented: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const expected = env['NX_OPERATOR_TOKEN'];
  if (!expected || expected.length < 24 || presented.length === 0) {
    return false;
  }
  return timingSafeEquals(presented, expected);
}

/**
 * Refuses unless an operator is signed in.
 *
 * Two ways in. A script or a test presents the token itself in a header; a person signs
 * in once and carries a derived session cookie. Both are checked in constant time, and a
 * refusal throws rather than returning false, so a caller cannot forget to check it.
 */
export async function requireOperator(): Promise<string> {
  const expected = process.env['NX_OPERATOR_TOKEN'];
  if (!expected || expected.length < 24) {
    throw new Error('NX_OPERATOR_TOKEN is not set, or is too short to be one');
  }

  const presented = await readOperatorCredential();
  const allowed =
    presented !== null &&
    (presented.kind === 'token'
      ? timingSafeEquals(presented.value, expected)
      : verifyOperatorSession(expected, presented.value));

  if (!allowed) {
    throw new Error('operator access requires a valid token');
  }

  return process.env['NX_OPERATOR_ID'] ?? 'nx-staff:unknown';
}

/**
 * The same check for a screen: the sign in page instead of an error.
 *
 * The redirect happens outside the try, because a redirect in Next is thrown and a catch
 * around it would swallow it.
 */
export async function operatorOrSignIn(): Promise<string> {
  let operatorId: string | null = null;
  try {
    operatorId = await requireOperator();
  } catch {
    operatorId = null;
  }
  if (operatorId === null) {
    const { redirect } = await import('next/navigation');
    return redirect('/operator/login') as never;
  }
  return operatorId;
}

/** Runs a query as the operator role, which crosses tenants for configuration only. */
export async function operatorQuery<T>(handler: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await handler({
      query: (text, values) => client.query(text, values as unknown[] | undefined),
    });
  } finally {
    client.release();
  }
}

async function readOperatorCredential(): Promise<{
  kind: 'token' | 'session';
  value: string;
} | null> {
  try {
    const { cookies, headers } = await import('next/headers');
    const headerStore = await headers();
    const fromHeader = headerStore.get('x-nx-operator-token');
    if (fromHeader) {
      return { kind: 'token', value: fromHeader };
    }
    const cookieStore = await cookies();
    const session = cookieStore.get(OPERATOR_COOKIE)?.value;
    return session ? { kind: 'session', value: session } : null;
  } catch {
    // Outside a request. Expected in tests and during a build.
    const override = process.env['NX_OPERATOR_TOKEN_OVERRIDE'];
    return override ? { kind: 'token', value: override } : null;
  }
}

function timingSafeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
