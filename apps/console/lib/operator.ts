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

/**
 * Refuses unless an operator token is presented.
 *
 * Compared in constant time, and it throws rather than returning false, so a caller
 * cannot forget to check the result.
 */
export async function requireOperator(): Promise<string> {
  const expected = process.env['NX_OPERATOR_TOKEN'];
  if (!expected || expected.length < 24) {
    throw new Error('NX_OPERATOR_TOKEN is not set, or is too short to be one');
  }

  const presented = await readOperatorToken();
  if (!presented || !timingSafeEquals(presented, expected)) {
    throw new Error('operator access requires a valid token');
  }

  return process.env['NX_OPERATOR_ID'] ?? 'nx-staff:unknown';
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

async function readOperatorToken(): Promise<string | null> {
  try {
    const { cookies, headers } = await import('next/headers');
    const headerStore = await headers();
    const fromHeader = headerStore.get('x-nx-operator-token');
    if (fromHeader) {
      return fromHeader;
    }
    const cookieStore = await cookies();
    return cookieStore.get('nx_operator')?.value ?? null;
  } catch {
    // Outside a request. Expected in tests and during a build.
    return process.env['NX_OPERATOR_TOKEN_OVERRIDE'] ?? null;
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
