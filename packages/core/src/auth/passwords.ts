import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';
import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { audit } from './audit.js';
import { createSession, type IssuedSession, type UserRole } from './users.js';

/**
 * Passwords, and why they are stored differently from API keys.
 *
 * An API key is 256 bits we generated, so there is nothing to brute force and a slow hash
 * would only add latency to every request. A password is chosen by a person, is short,
 * and has probably been used somewhere else, so it gets a deliberately slow derivation
 * with its own salt. Same reasoning, different input, opposite answer.
 *
 * scrypt is used because it ships with Node. Its cost parameters are stored beside each
 * hash rather than hardcoded, so they can be raised later without invalidating every
 * password that already exists.
 */

/** promisify picks the three argument overload, so the options form is wrapped by hand. */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  keylen: number;
}

/** Roughly a tenth of a second on current hardware. Raise it as hardware improves. */
export const DEFAULT_PARAMS: ScryptParams = { N: 16_384, r: 8, p: 1, keylen: 64 };

const SALT_BYTES = 16;
const MAX_FAILURES = 5;

async function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return scryptAsync(password.normalize('NFKC'), salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    // scrypt needs memory proportional to N and r, and refuses without room for it.
    maxmem: 256 * params.N * params.r,
  });
}

export interface PasswordRequirements {
  minLength: number;
}

export const PASSWORD_REQUIREMENTS: PasswordRequirements = { minLength: 12 };

/**
 * Length is the only rule.
 *
 * Composition rules push people towards Password1! and towards writing it down, which is
 * worse than a long passphrase. Length is what actually costs an attacker.
 */
export function assertPasswordAcceptable(password: string): void {
  if (password.normalize('NFKC').length < PASSWORD_REQUIREMENTS.minLength) {
    throw new NxError('NX-4001', {
      detail: `a password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`,
    });
  }
}

export interface SetPasswordInput {
  userId: string;
  password: string;
  mustChange?: boolean;
  actorId?: string;
}

export async function setPassword(tx: TenantTransaction, input: SetPasswordInput): Promise<void> {
  assertPasswordAcceptable(input.password);

  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(input.password, salt, DEFAULT_PARAMS);

  await tx.query(
    `INSERT INTO user_credentials (tenant_id, user_id, password_hash, salt, params, must_change)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       salt = EXCLUDED.salt,
       params = EXCLUDED.params,
       must_change = EXCLUDED.must_change,
       updated_at = now()`,
    [
      tx.tenantId,
      input.userId,
      hash,
      salt,
      JSON.stringify(DEFAULT_PARAMS),
      input.mustChange ?? false,
    ],
  );

  // Changing a password ends every other session. Someone who has just been locked out of
  // an account they compromised should not still be inside it.
  await tx.query(
    `UPDATE user_sessions SET revoked_at = now()
     WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tx.tenantId, input.userId],
  );

  await audit(tx, {
    actorType: 'USER',
    actorId: input.actorId ?? input.userId,
    action: 'user.password_set',
    target: input.userId,
  });
}

export interface LoginInput {
  /** The workspace the person is signing in to. */
  slug: string;
  email: string;
  password: string;
  ip?: string | null;
}

export interface LoginSuccess {
  tenantId: string;
  userId: string;
  role: UserRole;
  displayName: string;
  session: IssuedSession;
  mustChangePassword: boolean;
}

interface LoginRow {
  tenant_id: string;
  user_id: string;
  role: UserRole;
  display_name: string;
  password_hash: Buffer;
  salt: Buffer;
  params: ScryptParams;
  must_change: boolean;
  recent_failures: number;
}

/**
 * Signing in.
 *
 * Three things this deliberately does not do. It does not say whether the address exists,
 * because that turns a login form into a directory of who works there. It does not return
 * early when the person is unknown, because the difference in timing says the same thing
 * out loud. And it does not let failures accumulate without limit.
 */
export async function login(
  db: Queryable,
  createSessionFor: (
    tenantId: string,
    handler: (tx: TenantTransaction) => Promise<IssuedSession>,
  ) => Promise<IssuedSession>,
  input: LoginInput,
): Promise<LoginSuccess> {
  const { rows } = await db.query<LoginRow>(
    `SELECT tenant_id, user_id, role, display_name, password_hash, salt, params,
            must_change, recent_failures
     FROM app.resolve_login($1, $2)`,
    [input.slug, input.email],
  );

  const found = rows[0];

  if (!found) {
    // Spend the same work as a real verification would, so an unknown address is not
    // distinguishable by how long the answer took.
    await derive(input.password, randomBytes(SALT_BYTES), DEFAULT_PARAMS);
    throw new NxError('NX-4011');
  }

  if (found.recent_failures >= MAX_FAILURES) {
    await recordAttempt(db, found.tenant_id, found.user_id, false, input.ip ?? null);
    throw new NxError('NX-4029', {
      detail: 'too many failed attempts, this account is locked for a short period',
    });
  }

  const candidate = await derive(input.password, found.salt, found.params);
  const matches =
    candidate.length === found.password_hash.length &&
    timingSafeEqual(candidate, found.password_hash);

  await recordAttempt(db, found.tenant_id, found.user_id, matches, input.ip ?? null);

  if (!matches) {
    // The same error as an unknown address, for the same reason.
    throw new NxError('NX-4011');
  }

  const session = await createSessionFor(found.tenant_id, (tx) =>
    createSession(tx, { userId: found.user_id, ip: input.ip ?? null }),
  );

  return {
    tenantId: found.tenant_id,
    userId: found.user_id,
    role: found.role,
    displayName: found.display_name,
    session,
    mustChangePassword: found.must_change,
  };
}

/**
 * Changing your own password.
 *
 * The current one is required even though the person is already signed in, because a
 * session left open on a shared machine should not be enough to take an account.
 */
export async function changeOwnPassword(
  tx: TenantTransaction,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const { rows } = await tx.query<{
    password_hash: Buffer;
    salt: Buffer;
    params: ScryptParams;
  }>(
    `SELECT password_hash, salt, params FROM user_credentials
     WHERE tenant_id = $1 AND user_id = $2`,
    [tx.tenantId, userId],
  );

  const found = rows[0];
  if (!found) {
    throw new NxError('NX-4011');
  }

  const candidate = await derive(currentPassword, found.salt, found.params);
  if (
    candidate.length !== found.password_hash.length ||
    !timingSafeEqual(candidate, found.password_hash)
  ) {
    throw new NxError('NX-4011');
  }

  await setPassword(tx, { userId, password: newPassword, actorId: userId });
}

async function recordAttempt(
  db: Queryable,
  tenantId: string,
  userId: string,
  succeeded: boolean,
  ip: string | null,
): Promise<void> {
  await db.query('SELECT app.record_login_attempt($1, $2, $3, $4)', [
    tenantId,
    userId,
    succeeded,
    ip,
  ]);
}
