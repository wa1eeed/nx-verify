import type { Queryable } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { passwordMatches, sealPassword, type ScryptParams } from '../auth/passwords.js';
import { recordOperatorAudit } from './audit.js';

/**
 * The staff who run the platform, by name (PLAN.md, decision 5).
 *
 * The panel was entered with one token shared by everyone who had it, so a change could be
 * traced to the token and to nobody. Staff now sign in as themselves, with a role that
 * decides what they may change, and the trail names them (handoff screen 05). The token is
 * kept for the one thing a person cannot do without an account: making the first owner.
 *
 * Signing in is written like the subscriber sign in (auth/passwords.ts): an unknown address
 * costs the same work as a known one, the answer does not say which was wrong, and repeated
 * failures lock the account for a while.
 */

export type OperatorRole = 'OWNER' | 'PRICING' | 'SUPPORT' | 'READ_ONLY';
export type OperatorStatus = 'ACTIVE' | 'DISABLED';

export const OPERATOR_ROLES: readonly OperatorRole[] = ['OWNER', 'PRICING', 'SUPPORT', 'READ_ONLY'];

export const OPERATOR_ROLE_LABELS: Readonly<Record<OperatorRole, string>> = {
  OWNER: 'مالك',
  PRICING: 'التسعير',
  SUPPORT: 'الدعم',
  READ_ONLY: 'قراءة فقط',
};

/** What a role may change. Every role may look. */
export type OperatorPermission = 'pricing' | 'settings' | 'subscribers' | 'integration' | 'staff';

const PERMISSIONS: Readonly<Record<OperatorRole, readonly OperatorPermission[]>> = {
  OWNER: ['pricing', 'settings', 'subscribers', 'integration', 'staff'],
  PRICING: ['pricing', 'settings'],
  SUPPORT: ['subscribers'],
  READ_ONLY: [],
};

export function operatorCan(role: OperatorRole, permission: OperatorPermission): boolean {
  return PERMISSIONS[role].includes(permission);
}

export interface OperatorAccount {
  id: string;
  email: string;
  displayName: string;
  role: OperatorRole;
  status: OperatorStatus;
  lastSignInAt: Date | null;
  createdAt: Date;
  /**
   * Rises with every password, role or status change, and with an authenticator reset. A
   * session issued under an older version is refused on its next request (SEC-04).
   */
  credentialVersion: number;
  /** When this account finished enrolling an authenticator, or null while it has none (SEC-02). */
  secondFactorAt: Date | null;
  /**
   * Recovery codes still unused (ADR-152).
   *
   * Ten are issued once, at enrolment, and each works once. Somebody who has spent nine of
   * them is one lost phone away from being locked out of the panel, and the only way back is
   * another owner resetting them. That is worth seeing before it happens rather than after.
   */
  recoveryCodesLeft: number;
}

/** Who is acting in the panel: a member of staff, or the deployment's token itself. */
export interface OperatorIdentity {
  id: string;
  displayName: string;
  role: OperatorRole;
}

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  role: OperatorRole;
  status: OperatorStatus;
  last_sign_in_at: Date | null;
  created_at: Date;
  credential_version: number;
  totp_confirmed_at: Date | null;
  recovery_codes_left: number;
}

const COLUMNS = `id, email, display_name, role, status, last_sign_in_at, created_at,
                 credential_version, totp_confirmed_at,
                 (SELECT count(*) FROM jsonb_array_elements(coalesce(recovery_codes, '[]'::jsonb)) c
                   WHERE c->>'used_at' IS NULL)::int AS recovery_codes_left`;

function accountOf(row: AccountRow): OperatorAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    lastSignInAt: row.last_sign_in_at,
    createdAt: row.created_at,
    credentialVersion: row.credential_version,
    secondFactorAt: row.totp_confirmed_at,
    recoveryCodesLeft: row.recovery_codes_left,
  };
}

function normaliseEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) || value.length > 200) {
    throw new NxError('NX-4002', { detail: 'the email address is malformed' });
  }
  return value;
}

function assertRole(role: string): asserts role is OperatorRole {
  if (!OPERATOR_ROLES.includes(role as OperatorRole)) {
    throw new NxError('NX-4002', { detail: 'unknown operator role' });
  }
}

export async function countOperatorAccounts(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM operator_accounts`,
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listOperatorAccounts(db: Queryable): Promise<OperatorAccount[]> {
  const { rows } = await db.query<AccountRow>(
    `SELECT ${COLUMNS} FROM operator_accounts ORDER BY status, display_name`,
  );
  return rows.map(accountOf);
}

export async function getOperatorAccount(
  db: Queryable,
  id: string,
): Promise<OperatorAccount | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return null;
  }
  const { rows } = await db.query<AccountRow>(
    `SELECT ${COLUMNS} FROM operator_accounts WHERE id = $1`,
    [id],
  );
  return rows[0] ? accountOf(rows[0]) : null;
}

export interface CreateOperatorInput {
  email: string;
  displayName: string;
  role: OperatorRole;
  password: string;
}

async function insertAccount(
  db: Queryable,
  input: CreateOperatorInput,
  createdBy: string | null,
): Promise<OperatorAccount> {
  assertRole(input.role);
  const email = normaliseEmail(input.email);
  const displayName = input.displayName.trim();
  if (displayName.length < 2 || displayName.length > 80) {
    throw new NxError('NX-4002', { detail: 'a display name is 2 to 80 characters' });
  }
  const sealed = await sealPassword(input.password);
  try {
    const { rows } = await db.query<AccountRow>(
      `INSERT INTO operator_accounts
         (email, display_name, role, password_hash, password_salt, password_params, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING ${COLUMNS}`,
      [
        email,
        displayName,
        input.role,
        sealed.hash,
        sealed.salt,
        JSON.stringify(sealed.params),
        createdBy !== null && /^[0-9a-f-]{36}$/i.test(createdBy) ? createdBy : null,
      ],
    );
    return accountOf(rows[0] as AccountRow);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new NxError('NX-4091', { detail: 'an operator account with this email exists' });
    }
    throw error;
  }
}

/**
 * The first owner, made with the deployment's token.
 *
 * Only while no account exists: once there is an owner, staff are added by staff, and the
 * token cannot be used to slip a second owner in beside them.
 */
export async function createFirstOwner(
  db: Queryable,
  input: Omit<CreateOperatorInput, 'role'>,
): Promise<OperatorAccount> {
  if ((await countOperatorAccounts(db)) > 0) {
    throw new NxError('NX-4091', { detail: 'the panel already has an owner' });
  }
  const account = await insertAccount(db, { ...input, role: 'OWNER' }, null);
  await recordOperatorAudit(db, {
    operatorId: 'nx-staff:token',
    action: 'staff.first_owner',
    target: `staff:${account.id}`,
    metadata: { role: 'OWNER' },
  });
  return account;
}

export async function createOperatorAccount(
  db: Queryable,
  actor: OperatorIdentity,
  input: CreateOperatorInput,
): Promise<OperatorAccount> {
  if (!operatorCan(actor.role, 'staff')) {
    throw new NxError('NX-4031', { detail: 'only an owner adds staff' });
  }
  const account = await insertAccount(db, input, actor.id);
  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'staff.created',
    target: `staff:${account.id}`,
    metadata: { role: account.role },
  });
  return account;
}

/** Signing in as a member of staff. The error never says which half was wrong. */
export async function authenticateOperator(
  db: Queryable,
  email: string,
  password: string,
  now: Date = new Date(),
): Promise<OperatorAccount> {
  const value = email.trim().toLowerCase();
  const { rows } = await db.query<
    AccountRow & {
      password_hash: Buffer;
      password_salt: Buffer;
      password_params: ScryptParams;
      failed_attempts: number;
      locked_until: Date | null;
    }
  >(
    `SELECT ${COLUMNS}, password_hash, password_salt, password_params, failed_attempts, locked_until
     FROM operator_accounts WHERE lower(email) = $1`,
    [value],
  );
  const found = rows[0];

  if (found && found.locked_until !== null && found.locked_until > now) {
    await passwordMatches(password, null);
    throw new NxError('NX-4029', { detail: 'too many failed attempts, try again later' });
  }

  const matches = await passwordMatches(
    password,
    found
      ? { hash: found.password_hash, salt: found.password_salt, params: found.password_params }
      : null,
  );

  if (!found || !matches || found.status !== 'ACTIVE') {
    if (found) {
      // The fifth failure in a row locks the account for a while, and the count starts again
      // when the lock lifts.
      await db.query(
        `UPDATE operator_accounts
         SET failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END,
             locked_until = CASE WHEN failed_attempts + 1 >= $2
                                 THEN $3::timestamptz + make_interval(mins => $4) END
         WHERE id = $1`,
        [found.id, MAX_FAILURES, now, LOCK_MINUTES],
      );
    }
    throw new NxError('NX-4011');
  }

  await db.query(
    `UPDATE operator_accounts
     SET failed_attempts = 0, locked_until = NULL, last_sign_in_at = $2
     WHERE id = $1`,
    [found.id, now],
  );
  return { ...accountOf(found), lastSignInAt: now };
}

async function activeOwners(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM operator_accounts WHERE role = 'OWNER' AND status = 'ACTIVE'`,
  );
  return rows.map((row) => row.id);
}

/** A role or a status changed. The panel always keeps one active owner. */
export async function updateOperatorAccount(
  db: Queryable,
  actor: OperatorIdentity,
  id: string,
  change: { role?: OperatorRole; status?: OperatorStatus },
): Promise<OperatorAccount> {
  if (!operatorCan(actor.role, 'staff')) {
    throw new NxError('NX-4031', { detail: 'only an owner changes staff' });
  }
  const account = await getOperatorAccount(db, id);
  if (!account) {
    throw new NxError('NX-4041', { detail: 'no such operator account' });
  }
  if (change.role !== undefined) {
    assertRole(change.role);
  }
  if (change.status !== undefined && change.status !== 'ACTIVE' && change.status !== 'DISABLED') {
    throw new NxError('NX-4002', { detail: 'unknown operator status' });
  }
  const losesOwner =
    account.role === 'OWNER' &&
    account.status === 'ACTIVE' &&
    ((change.role !== undefined && change.role !== 'OWNER') || change.status === 'DISABLED');
  if (losesOwner && (await activeOwners(db)).length <= 1) {
    throw new NxError('NX-4091', { detail: 'the panel must keep one active owner' });
  }

  const { rows } = await db.query<AccountRow>(
    `UPDATE operator_accounts
     SET role = COALESCE($2, role), status = COALESCE($3, status),
         -- A demotion or a disabling takes effect at once: every session this person holds is
         -- issued under the old version and is refused on its next request (SEC-04).
         credential_version = credential_version + 1, updated_at = now()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, change.role ?? null, change.status ?? null],
  );
  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'staff.updated',
    target: `staff:${id}`,
    metadata: {
      ...(change.role ? { role: change.role } : {}),
      ...(change.status ? { status: change.status } : {}),
    },
  });
  return accountOf(rows[0] as AccountRow);
}

/** A new password for a member of staff, set by an owner or by the member themselves. */
export async function setOperatorPassword(
  db: Queryable,
  actor: OperatorIdentity,
  id: string,
  password: string,
): Promise<void> {
  if (actor.id !== id && !operatorCan(actor.role, 'staff')) {
    throw new NxError('NX-4031', { detail: 'only an owner sets another member of staff password' });
  }
  const sealed = await sealPassword(password);
  const { rowCount } = await db.query(
    `UPDATE operator_accounts
     SET password_hash = $2, password_salt = $3, password_params = $4::jsonb,
         failed_attempts = 0, locked_until = NULL,
         -- Sessions opened with the old password stop working (SEC-04).
         credential_version = credential_version + 1, updated_at = now()
     WHERE id = $1`,
    [id, sealed.hash, sealed.salt, JSON.stringify(sealed.params)],
  );
  if ((rowCount ?? 0) === 0) {
    throw new NxError('NX-4041', { detail: 'no such operator account' });
  }
  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'staff.password_set',
    target: `staff:${id}`,
  });
}
