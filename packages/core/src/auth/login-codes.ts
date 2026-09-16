import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';

/**
 * The second step a subscriber's own users take (ADR-143).
 *
 * A code to the address they already sign in with, after the password. Not the panel's
 * authenticator: the panel holds every subscriber and mail is also how a password is
 * recovered there, so a mailed code would be the same factor twice. A subscriber's users are
 * many and are not staff, and asking each of them to enrol an authenticator ends in a shared
 * password, which is worse than what it replaced.
 *
 * Shaped like the session it eventually mints. The browser carries an opaque handle and the
 * database keeps its digest; the six digits are hashed with that handle as salt, so the same
 * code issued to two people is two different digests and a stolen table cannot be searched for
 * a known code. Nothing stored here is reversible into anything anybody typed.
 */

/** Six digits: short enough to read out of a mail, and spent after five guesses. */
const CODE_DIGITS = 6;
const HANDLE_BYTES = 24;
export const MAX_CODE_ATTEMPTS = 5;
export const CODE_TTL_MINUTES = 10;
/** A second code for the same person is refused inside this, so a button cannot be a mailer. */
export const RESEND_AFTER_SECONDS = 60;

export interface IssuedLoginCode {
  /** What the browser carries. Returned once, stored as a digest, never read back. */
  handle: string;
  /** The six digits. Returned once, to be mailed and then forgotten. */
  code: string;
  expiresAt: Date;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** The code, salted with the handle, so two people holding the same digits differ on disk. */
function codeDigest(handle: string, code: string): Buffer {
  return createHash('sha256').update(`${handle}:${code}`).digest();
}

function sixDigits(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
}

/**
 * Issues a code for somebody whose password has already been accepted.
 *
 * Replaces whatever was waiting: a person who asks again should not have two codes in a
 * mailbox and no way to tell which is live. Asking again inside a minute is refused, so the
 * button on the screen cannot be turned into a way to send mail to somebody.
 */
export async function issueLoginCode(
  tx: TenantTransaction,
  input: { userId: string; ip?: string | null },
): Promise<IssuedLoginCode> {
  const { rows: recent } = await tx.query<{ created_at: Date }>(
    `SELECT created_at FROM user_login_codes
      WHERE tenant_id = $1 AND user_id = $2 AND consumed_at IS NULL`,
    [tx.tenantId, input.userId],
  );
  const last = recent[0]?.created_at;
  if (last !== undefined && Date.now() - last.getTime() < RESEND_AFTER_SECONDS * 1_000) {
    throw new NxError('NX-4029', {
      detail: 'a code was sent moments ago',
      cause: 'أُرسل رمز قبل قليل. انتظر دقيقة ثم اطلب غيره.',
    });
  }

  const handle = `nxp_${randomBytes(HANDLE_BYTES).toString('base64url')}`;
  const code = sixDigits();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);

  await tx.query(
    `DELETE FROM user_login_codes
      WHERE tenant_id = $1 AND user_id = $2 AND consumed_at IS NULL`,
    [tx.tenantId, input.userId],
  );
  await tx.query(
    `INSERT INTO user_login_codes (tenant_id, user_id, pending_hash, code_hash, expires_at, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      tx.tenantId,
      input.userId,
      digest(handle),
      codeDigest(handle, code),
      expiresAt,
      input.ip ?? null,
    ],
  );

  return { handle, code, expiresAt };
}

export interface RedeemedLoginCode {
  userId: string;
}

/**
 * Spends a code, or says nothing useful about why it could not.
 *
 * Every refusal is the same error. A caller who learns «that handle is unknown» from «those
 * digits are wrong» from «you have guessed too often» learns which half they got right, and
 * the whole point of six digits is that they cannot.
 *
 * A wrong guess is counted before it is answered, so a loop that never finishes still spends
 * the budget it is loosing.
 */
export async function redeemLoginCode(
  tx: TenantTransaction,
  input: { handle: string; code: string },
): Promise<RedeemedLoginCode> {
  const refuse = (): never => {
    throw new NxError('NX-4011', {
      detail: 'the code is wrong, spent or expired',
      cause: 'الرمز غير صحيح أو انتهت مدته.',
    });
  };

  const { rows } = await tx.query<{
    id: string;
    user_id: string;
    code_hash: Buffer;
    attempts: number;
    expires_at: Date;
    consumed_at: Date | null;
  }>(
    `SELECT id, user_id, code_hash, attempts, expires_at, consumed_at
       FROM user_login_codes
      WHERE tenant_id = $1 AND pending_hash = $2
      FOR UPDATE`,
    [tx.tenantId, digest(input.handle)],
  );
  const pending = rows[0];
  if (
    pending === undefined ||
    pending.consumed_at !== null ||
    pending.expires_at.getTime() <= Date.now() ||
    pending.attempts >= MAX_CODE_ATTEMPTS
  ) {
    return refuse();
  }

  const offered = codeDigest(input.handle, input.code.trim());
  const matches =
    offered.length === pending.code_hash.length && timingSafeEqual(offered, pending.code_hash);

  if (!matches) {
    await tx.query(`UPDATE user_login_codes SET attempts = attempts + 1 WHERE id = $1`, [
      pending.id,
    ]);
    return refuse();
  }

  await tx.query(
    `UPDATE user_login_codes SET consumed_at = now(), attempts = attempts + 1 WHERE id = $1`,
    [pending.id],
  );
  return { userId: pending.user_id };
}

/**
 * Clears what is spent or stale.
 *
 * Called by the retention sweep. A consumed code is kept briefly rather than deleted on use,
 * so a person who presses back and submits twice is refused rather than shown a login screen
 * with no explanation.
 */
export async function pruneLoginCodes(tx: TenantTransaction): Promise<number> {
  const { rowCount } = await tx.query(
    `DELETE FROM user_login_codes
      WHERE tenant_id = $1
        AND (expires_at < now() - interval '1 day' OR consumed_at < now() - interval '1 day')`,
    [tx.tenantId],
  );
  return rowCount ?? 0;
}
