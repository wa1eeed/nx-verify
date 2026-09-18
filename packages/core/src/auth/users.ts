import { createHash, randomBytes } from 'node:crypto';
import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { audit } from './audit.js';
import { countAdministrators, withAdminRemaining } from './capabilities.js';

/**
 * The customer's own people, and what each of them may do.
 *
 * docs/01-blueprint.md section 6.2: viewer, analyst, approver, manager. The separation
 * that earns its keep is between the analyst who decides and the approver who signs off,
 * and it is enforced in the database rather than here, because a rule that lives only in
 * application code is a rule a hotfix removes.
 *
 * A staff email is stored in the clear. Rule 4 protects the identifiers of subjects, the
 * people and companies being verified. A login address belongs to the customer's own
 * employee, is chosen by them, and is needed to sign in. Different data, different reason
 * for existing.
 */

/**
 * A role is a preset for a job in the subscriber's company, not a tier of seniority. What
 * each one carries, and how an administrator hands out one extra permission or takes one
 * away, is in capabilities.ts.
 */
export type UserRole =
  | 'VIEWER'
  | 'ANALYST'
  | 'APPROVER'
  | 'FINANCE'
  | 'COMPLIANCE'
  | 'ADMIN';

export const USER_ROLES: readonly UserRole[] = [
  'VIEWER',
  'ANALYST',
  'APPROVER',
  'FINANCE',
  'COMPLIANCE',
  'ADMIN',
];

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

export interface User {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: 'active' | 'disabled';
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  role: UserRole;
}

export async function createUser(
  tx: TenantTransaction,
  input: CreateUserInput,
  actorId?: string,
): Promise<string> {
  const { rows } = await tx
    .query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, display_name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
      [tx.tenantId, input.email.trim(), input.displayName.trim(), input.role],
    )
    .catch((error: unknown) => {
      if (isUniqueViolation(error)) {
        throw new NxError('NX-4091', { detail: 'that address already belongs to a user' });
      }
      throw error;
    });

  const id = rows[0]?.id;
  if (!id) {
    throw new NxError('NX-5001', { detail: 'user insert returned no id' });
  }

  await audit(tx, {
    actorType: 'USER',
    actorId: actorId ?? 'system',
    action: 'user.created',
    target: id,
    metadata: { role: input.role },
  });

  return id;
}

export async function listUsers(tx: TenantTransaction): Promise<User[]> {
  const { rows } = await tx.query<{
    id: string;
    email: string;
    display_name: string;
    role: UserRole;
    status: 'active' | 'disabled';
  }>(
    `SELECT id, email, display_name, role, status
     FROM users WHERE tenant_id = $1 ORDER BY display_name`,
    [tx.tenantId],
  );

  return rows.map((row) => ({
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
  }));
}

export async function getUser(tx: TenantTransaction, userId: string): Promise<User | null> {
  const { rows } = await tx.query<{
    id: string;
    email: string;
    display_name: string;
    role: UserRole;
    status: 'active' | 'disabled';
  }>(
    `SELECT id, email, display_name, role, status
     FROM users WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, userId],
  );

  const row = rows[0];
  return row === undefined
    ? null
    : {
        userId: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        status: row.status,
      };
}

/**
 * How many people can still administer this workspace.
 *
 * Asked before anything that could reduce it. A workspace with no administrator cannot
 * add one: there is nobody left who may, and the only way back is for us to reach into
 * their database, which is not a support process anybody should have.
 *
 * Counting people whose role is ADMIN stopped being the right question once a capability
 * could be handed out on its own. The answer is whoever effectively holds `users.manage`,
 * which includes somebody granted it as an exception and excludes an administrator it was
 * taken from.
 */
export async function countActiveAdmins(tx: TenantTransaction): Promise<number> {
  return countAdministrators(tx);
}

export async function setUserRole(
  tx: TenantTransaction,
  userId: string,
  role: UserRole,
  actorId: string,
): Promise<void> {
  // The change is made and then the database is asked whether anybody can still administer,
  // because predicting it from the role alone is wrong for somebody carrying an exception.
  // The savepoint inside undoes it if the answer is nobody.
  await withAdminRemaining(tx, async () => {
    const { rowCount } = await tx.query(
      `UPDATE users SET role = $3 WHERE tenant_id = $1 AND id = $2`,
      [tx.tenantId, userId, role],
    );
    if (rowCount === 0) {
      throw new NxError('NX-4041', { detail: 'no such user' });
    }
  });

  await audit(tx, {
    actorType: 'USER',
    actorId,
    action: 'user.role_changed',
    target: userId,
    metadata: { role },
  });
}

export async function disableUser(
  tx: TenantTransaction,
  userId: string,
  actorId: string,
): Promise<void> {
  if (userId === actorId) {
    // Locking yourself out is never the thing you meant to do, and the recovery is a
    // support ticket to us rather than anything they can do themselves.
    throw new NxError('NX-4091', { detail: 'an account cannot disable itself' });
  }

  await withAdminRemaining(tx, async () => {
    await tx.query(`UPDATE users SET status = 'disabled' WHERE tenant_id = $1 AND id = $2`, [
      tx.tenantId,
      userId,
    ]);
    await tx.query(
      `UPDATE user_sessions SET revoked_at = now()
       WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [tx.tenantId, userId],
    );
  });

  // Disabling someone who is signed in has to end their session, or the account is
  // disabled everywhere except where it matters.
  await audit(tx, {
    actorType: 'USER',
    actorId,
    action: 'user.disabled',
    target: userId,
  });
}

/**
 * Lets a disabled account back in.
 *
 * Their old sessions stay revoked. Coming back is a new sign in, not the resumption of
 * the one that was cut off, because the reason for disabling them may not have gone away
 * on the device that session was open on.
 */
export async function enableUser(
  tx: TenantTransaction,
  userId: string,
  actorId: string,
): Promise<void> {
  const { rowCount } = await tx.query(
    `UPDATE users SET status = 'active' WHERE tenant_id = $1 AND id = $2 AND status = 'disabled'`,
    [tx.tenantId, userId],
  );
  if (rowCount === 0) {
    throw new NxError('NX-4041', { detail: 'no such disabled user' });
  }

  await audit(tx, {
    actorType: 'USER',
    actorId,
    action: 'user.enabled',
    target: userId,
  });
}

/**
 * There is deliberately no `canDecide(role)` here any more.
 *
 * A function that answers «may they» from the role column alone became a lie the moment an
 * administrator could hand one capability to one person: it would hide a button the database
 * would have allowed, or show one the database refuses. Every caller asks
 * `capabilitiesOf(tx, userId)` and then `assertCan`, which is the same answer the four eyes
 * trigger reads. See capabilities.ts.
 */

/**
 * Sessions.
 *
 * Stored the way API keys are: a SHA-256 hash and nothing else, so a stolen database
 * yields no working session. The token exists once, in the response that created it.
 */
export interface IssuedSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export interface CreateSessionInput {
  userId: string;
  ttlHours?: number;
  ip?: string | null;
}

export async function createSession(
  tx: TenantTransaction,
  input: CreateSessionInput,
): Promise<IssuedSession> {
  const token = `nxs_${randomBytes(32).toString('base64url')}`;
  const ttlHours = input.ttlHours ?? 12;

  const { rows } = await tx.query<{ id: string; expires_at: Date }>(
    `INSERT INTO user_sessions (tenant_id, user_id, token_hash, expires_at, ip)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5::inet)
     RETURNING id, expires_at`,
    [tx.tenantId, input.userId, hashSessionToken(token), ttlHours, input.ip ?? null],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-5001', { detail: 'session insert returned no id' });
  }

  await tx.query(`UPDATE users SET last_seen_at = now() WHERE tenant_id = $1 AND id = $2`, [
    tx.tenantId,
    input.userId,
  ]);

  return { sessionId: row.id, token, expiresAt: row.expires_at };
}

export interface ResolvedSession {
  tenantId: string;
  userId: string;
  role: UserRole;
  displayName: string;
}

/**
 * Resolves a session token to a person and a tenant.
 *
 * Like the API key lookup, this is one of the few things that cannot be tenant scoped,
 * because it is what determines the tenant. It runs through a security definer function
 * owned by a role that can read two tables and do nothing else (ADR-022).
 */
export async function resolveSession(
  db: Queryable,
  token: string,
): Promise<ResolvedSession | null> {
  if (!token.startsWith('nxs_')) {
    return null;
  }

  const { rows } = await db.query<{
    tenant_id: string;
    user_id: string;
    role: UserRole;
    display_name: string;
  }>('SELECT tenant_id, user_id, role, display_name FROM app.resolve_session($1)', [
    hashSessionToken(token),
  ]);

  const row = rows[0];
  return row === undefined
    ? null
    : {
        tenantId: row.tenant_id,
        userId: row.user_id,
        role: row.role,
        displayName: row.display_name,
      };
}

export async function revokeSession(tx: TenantTransaction, sessionId: string): Promise<void> {
  await tx.query(
    `UPDATE user_sessions SET revoked_at = now()
     WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL`,
    [tx.tenantId, sessionId],
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
