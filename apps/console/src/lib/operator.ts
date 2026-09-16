import { createHmac } from 'node:crypto';
import { createPool, serialisedQuery, type Queryable } from '@nx-verify/db';
import {
  getOperatorAccount,
  operatorCan,
  type OperatorIdentity,
  type OperatorPermission,
} from '@nx-verify/core';
import type pg from 'pg';

/**
 * The operator surface.
 *
 * Kept apart from everything a subscriber can reach, and for one reason: rule 5. A
 * customer must never learn which provider serves them, and the only way to be sure of
 * that is for the screens that name providers to be unreachable from a customer session.
 *
 * So this uses its own connection, as its own database role, behind its own sign in. It
 * shares no session, no pool and no page with the tenant console. A bug in a tenant
 * screen cannot reach a provider name, because the code that reads them cannot run
 * without a member of staff signed in and an operator connection.
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

/** How long a sign in to the panel lasts before the password is asked for again. */
export const OPERATOR_SESSION_HOURS = 8;

const SESSION_LABEL = 'nx-operator-session/v3';
const PENDING_LABEL = 'nx-operator-pending/v1';

/** The cookie that holds a sign in between the password and the code (SEC-02). */
export const OPERATOR_PENDING_COOKIE = 'nx_operator_pending';

/** How long the second step may be left unfinished. */
export const OPERATOR_PENDING_MINUTES = 10;

/** What the second step is for: enrolling an authenticator, or proving one. */
export type PendingStage = 'enrol' | 'verify';

/**
 * How long the deployment's token must be (SEC-06).
 *
 * A deployment's token makes the first owner and seals every panel session, so a guessable
 * one is the panel. In production it must be 32 random bytes, which is 43 characters written
 * in base64, generated the way the secrets guide says: `openssl rand -base64 32`. Outside
 * production a shorter one is allowed, because a developer's token opens a developer's
 * database and typing 43 characters to run a script is friction that buys nothing.
 */
export const OPERATOR_TOKEN_MINIMUM = 24;
export const OPERATOR_TOKEN_MINIMUM_PRODUCTION = 43;

export function operatorTokenMinimum(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return env['NODE_ENV'] === 'production'
    ? OPERATOR_TOKEN_MINIMUM_PRODUCTION
    : OPERATOR_TOKEN_MINIMUM;
}

/** Whether this deployment has a panel at all. Without a long enough token nobody signs in. */
export function operatorPanelEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const token = env['NX_OPERATOR_TOKEN'];
  return token !== undefined && token.length >= operatorTokenMinimum(env);
}

/**
 * The cookie value for a member of staff who signed in.
 *
 * It names the account, the version of their credentials it was issued under and when the sign
 * in ends, sealed with the deployment's token. The browser never holds the token, a value stops
 * working at its expiry, rotating the token signs everybody out, and disabling an account signs
 * that person out at their next request, because the account is read back on every one.
 *
 * The credential version is what makes a changed password, a demotion or a reset authenticator
 * take effect at once rather than in eight hours (SEC-04).
 */
export function operatorSessionValue(
  token: string,
  accountId: string,
  credentialVersion: number,
  expiresAtMs: number,
): string {
  const mac = createHmac('sha256', token)
    .update(`${SESSION_LABEL}|${accountId}|${credentialVersion}|${expiresAtMs}`)
    .digest('base64url');
  return `v3.${accountId}.${credentialVersion}.${expiresAtMs}.${mac}`;
}

export interface OperatorSession {
  accountId: string;
  credentialVersion: number;
}

/** The account a session value names, when the value is ours and has not expired. */
export function readOperatorSession(
  token: string,
  value: string,
  nowMs: number = Date.now(),
): OperatorSession | null {
  const [version, accountId, credentials, expires, mac] = value.split('.');
  if (
    version !== 'v3' ||
    !accountId ||
    !credentials ||
    !expires ||
    !mac ||
    !/^[0-9a-f-]{36}$/i.test(accountId)
  ) {
    return null;
  }
  const credentialVersion = Number(credentials);
  const expiresAt = Number(expires);
  if (!Number.isSafeInteger(credentialVersion) || credentialVersion <= 0) {
    return null;
  }
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowMs) {
    return null;
  }
  // A value claiming to last longer than any sign in can was not issued by us.
  if (expiresAt - nowMs > OPERATOR_SESSION_HOURS * 3_600_000 + 60_000) {
    return null;
  }
  return timingSafeEquals(
    value,
    operatorSessionValue(token, accountId, credentialVersion, expiresAt),
  )
    ? { accountId, credentialVersion }
    : null;
}

/**
 * The value that carries a sign in between the password and the code (SEC-02).
 *
 * It opens no screen of the panel: it says only that this account gave the right password a few
 * minutes ago, and what the second step is for. Sealed and read exactly as a session is.
 */
export function operatorPendingValue(
  token: string,
  accountId: string,
  stage: PendingStage,
  expiresAtMs: number,
): string {
  const mac = createHmac('sha256', token)
    .update(`${PENDING_LABEL}|${accountId}|${stage}|${expiresAtMs}`)
    .digest('base64url');
  return `p1.${accountId}.${stage}.${expiresAtMs}.${mac}`;
}

export function readOperatorPending(
  token: string,
  value: string,
  nowMs: number = Date.now(),
): { accountId: string; stage: PendingStage } | null {
  const [version, accountId, stage, expires, mac] = value.split('.');
  if (
    version !== 'p1' ||
    !accountId ||
    (stage !== 'enrol' && stage !== 'verify') ||
    !expires ||
    !mac ||
    !/^[0-9a-f-]{36}$/i.test(accountId)
  ) {
    return null;
  }
  const expiresAt = Number(expires);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowMs) {
    return null;
  }
  if (expiresAt - nowMs > OPERATOR_PENDING_MINUTES * 60_000 + 60_000) {
    return null;
  }
  return timingSafeEquals(value, operatorPendingValue(token, accountId, stage, expiresAt))
    ? { accountId, stage }
    : null;
}

/** Compares a presented token with the configured one, in constant time. */
export function operatorTokenMatches(
  presented: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const expected = env['NX_OPERATOR_TOKEN'];
  if (!expected || expected.length < operatorTokenMinimum(env) || presented.length === 0) {
    return false;
  }
  return timingSafeEquals(presented, expected);
}

/** The deployment's token acting for a script or a test: an owner with no name. */
export const TOKEN_OPERATOR: OperatorIdentity = {
  id: 'nx-staff:token',
  displayName: 'مفتاح النشر',
  role: 'OWNER',
};

/**
 * Who is acting in the panel, or a refusal.
 *
 * Staff sign in as themselves and carry a session naming their account, which is read back
 * on every request and must still be active. The token itself stands in for a person only
 * outside production, for the scripts, tests and screenshots that have no account to sign in
 * with; in a deployment it makes the first owner and nothing else (PLAN.md, decision 5). A
 * refusal throws rather than returning, so a caller cannot forget to check it.
 */
export async function currentOperator(): Promise<OperatorIdentity> {
  const expected = process.env['NX_OPERATOR_TOKEN'];
  if (!expected || expected.length < operatorTokenMinimum()) {
    throw new Error('NX_OPERATOR_TOKEN is not set, or is too short to be one');
  }

  const presented = await readOperatorCredential();
  if (
    presented.token !== null &&
    process.env['NODE_ENV'] !== 'production' &&
    timingSafeEquals(presented.token, expected)
  ) {
    return TOKEN_OPERATOR;
  }
  const session =
    presented.session === null ? null : readOperatorSession(expected, presented.session);
  if (session !== null) {
    const account = await operatorQuery((db) => getOperatorAccount(db, session.accountId));
    if (
      account !== null &&
      account.status === 'ACTIVE' &&
      // A password change, a demotion or a reset authenticator raises the version, and every
      // session issued before it stops here (SEC-04).
      account.credentialVersion === session.credentialVersion &&
      // A member of staff without an authenticator cannot hold a session at all (SEC-02).
      account.secondFactorAt !== null
    ) {
      return { id: account.id, displayName: account.displayName, role: account.role };
    }
  }
  throw new Error('operator access requires a signed in member of staff');
}

/** The acting operator's id, for the functions that record who did something. */
export async function requireOperator(): Promise<string> {
  return (await currentOperator()).id;
}

/** The acting operator, who must hold this permission. */
export async function requireOperatorPermission(
  permission: OperatorPermission,
): Promise<OperatorIdentity> {
  const identity = await currentOperator();
  if (!operatorCan(identity.role, permission)) {
    throw new Error(`the ${identity.role} role may not change ${permission}`);
  }
  return identity;
}

/**
 * The same check for a screen: the sign in page instead of an error.
 *
 * The redirect happens outside the try, because a redirect in Next is thrown and a catch
 * around it would swallow it.
 */
export async function operatorOrSignIn(): Promise<OperatorIdentity> {
  let identity: OperatorIdentity | null = null;
  try {
    identity = await currentOperator();
  } catch {
    identity = null;
  }
  if (identity === null) {
    const { redirect } = await import('next/navigation');
    return redirect('/operator/login') as never;
  }
  return identity;
}

/** Runs a query as the operator role, which crosses tenants for configuration only. */
export async function operatorQuery<T>(handler: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    // One statement at a time on one connection, so a screen may gather its facts with
    // Promise.all without asking this client for two answers at once.
    return await handler({ query: serialisedQuery(client) });
  } finally {
    client.release();
  }
}

/**
 * The same, in one transaction: a save that changes several prices changes all of them or
 * none, so a refusal halfway down a table never leaves half a price list behind.
 */
export async function operatorTransaction<T>(handler: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await handler({ query: serialisedQuery(client) });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function panelToken(): string {
  const token = process.env['NX_OPERATOR_TOKEN'];
  if (!token || token.length < operatorTokenMinimum()) {
    throw new Error('NX_OPERATOR_TOKEN is not set, or is too short to be one');
  }
  return token;
}

function cookieOptions(expiresAt: number): {
  httpOnly: true;
  sameSite: 'strict';
  secure: boolean;
  path: string;
  expires: Date;
} {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/operator',
    expires: new Date(expiresAt),
  };
}

/** Starts a member of staff's sign in: the cookie, scoped to the panel's own path. */
export async function startOperatorSession(
  accountId: string,
  credentialVersion: number,
): Promise<void> {
  const token = panelToken();
  const { cookies } = await import('next/headers');
  const expiresAt = Date.now() + OPERATOR_SESSION_HOURS * 3_600_000;
  const jar = await cookies();
  jar.set(
    OPERATOR_COOKIE,
    operatorSessionValue(token, accountId, credentialVersion, expiresAt),
    cookieOptions(expiresAt),
  );
  // The second step is over: nothing should be left that could start it again.
  jar.delete({ name: OPERATOR_PENDING_COOKIE, path: '/operator' });
}

/** Holds a sign in at its second step, for a few minutes (SEC-02). */
export async function startOperatorSecondStep(
  accountId: string,
  stage: PendingStage,
): Promise<void> {
  const token = panelToken();
  const { cookies } = await import('next/headers');
  const expiresAt = Date.now() + OPERATOR_PENDING_MINUTES * 60_000;
  (await cookies()).set(
    OPERATOR_PENDING_COOKIE,
    operatorPendingValue(token, accountId, stage, expiresAt),
    cookieOptions(expiresAt),
  );
}

/** Who is at the second step of a sign in, if anybody. */
export async function pendingOperator(): Promise<{
  accountId: string;
  stage: PendingStage;
} | null> {
  const token = process.env['NX_OPERATOR_TOKEN'];
  if (!token || token.length < 24) {
    return null;
  }
  const { cookies } = await import('next/headers');
  const value = (await cookies()).get(OPERATOR_PENDING_COOKIE)?.value;
  return value ? readOperatorPending(token, value) : null;
}

/** Ends a half finished sign in, when the person gives up or starts again. */
export async function endOperatorSecondStep(): Promise<void> {
  const { cookies } = await import('next/headers');
  (await cookies()).delete({ name: OPERATOR_PENDING_COOKIE, path: '/operator' });
}

async function readOperatorCredential(): Promise<{
  token: string | null;
  session: string | null;
}> {
  try {
    const { cookies, headers } = await import('next/headers');
    const token = (await headers()).get('x-nx-operator-token');
    const session = (await cookies()).get(OPERATOR_COOKIE)?.value;
    return { token: token || null, session: session || null };
  } catch {
    // Outside a request. Expected in tests and during a build.
    return { token: process.env['NX_OPERATOR_TOKEN_OVERRIDE'] || null, session: null };
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
