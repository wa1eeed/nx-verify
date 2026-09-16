import { hkdfSync, randomBytes } from 'node:crypto';
import type { Queryable } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { openSecret, sealSecret } from '../crypto/secret-box.js';
import type { MasterKeySource } from '../crypto/master-key.js';
import { passwordMatches, sealPassword, type ScryptParams } from '../auth/passwords.js';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  readableSecret,
  verifyTotp,
} from '../auth/totp.js';
import { recordOperatorAudit } from './audit.js';
import { operatorCan, type OperatorIdentity } from './accounts.js';

/**
 * The second factor of the administration panel (SEC-02).
 *
 * Every member of staff proves twice who they are: the password they know, and a code from the
 * authenticator they hold. A member who has not enrolled yet cannot reach a single screen of
 * the panel: the sign in stops at enrolment, so the requirement cannot be postponed into
 * never.
 *
 * The secret is sealed the way an identifier is, with a key derived from the deployment's
 * master key, so the database alone yields nothing (rule 4) and no key is stored beside it
 * (rule 10). The recovery codes are sealed the way a password is, one salt each, shown once
 * when they are made and never again; using one marks it used and says so in the trail.
 */

const KEY_INFO = 'nx-verify/operator-totp/v1';
const KEY_BYTES = 32;
/** The panel has no tenant, so the derivation is salted with the surface it protects. */
const KEY_SALT = 'nx-operator-panel';

const RECOVERY_CODES = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ISSUER = 'NX Trust';

async function panelKey(source: MasterKeySource, version: number): Promise<Buffer> {
  return Buffer.from(
    hkdfSync(
      'sha256',
      await source.masterKey(version),
      KEY_SALT,
      `${KEY_INFO}/v${version}`,
      KEY_BYTES,
    ),
  );
}

interface SecondFactorRow {
  id: string;
  email: string;
  display_name: string;
  totp_secret_enc: Buffer | null;
  totp_key_version: number | null;
  totp_confirmed_at: Date | null;
  totp_last_step: string | null;
  recovery_codes: SealedRecoveryCode[];
}

interface SealedRecoveryCode {
  hash: string;
  salt: string;
  params: ScryptParams;
  used_at: string | null;
}

const COLUMNS = `id, email, display_name, totp_secret_enc, totp_key_version, totp_confirmed_at,
                 totp_last_step, recovery_codes`;

async function readAccount(db: Queryable, id: string): Promise<SecondFactorRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new NxError('NX-4041', { detail: 'no such operator account' });
  }
  const { rows } = await db.query<SecondFactorRow>(
    `SELECT ${COLUMNS} FROM operator_accounts WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', { detail: 'no such operator account' });
  }
  return row;
}

/** Whether this account has finished enrolling an authenticator. */
export function hasSecondFactor(row: {
  totp_secret_enc: Buffer | null;
  totp_confirmed_at: Date | null;
}): boolean {
  return row.totp_secret_enc !== null && row.totp_confirmed_at !== null;
}

export async function operatorHasSecondFactor(db: Queryable, id: string): Promise<boolean> {
  return hasSecondFactor(await readAccount(db, id));
}

async function secretOf(keys: MasterKeySource, row: SecondFactorRow): Promise<Buffer | null> {
  if (row.totp_secret_enc === null || row.totp_key_version === null) {
    return null;
  }
  return base32Decode(openSecret(await panelKey(keys, row.totp_key_version), row.totp_secret_enc));
}

export interface SecondFactorEnrolment {
  /** The secret in groups of four, for an authenticator that cannot scan a code. */
  secret: string;
  /** What the QR code encodes. */
  uri: string;
}

/**
 * The secret an account is enrolling with: the one already started, or a new one.
 *
 * Kept unconfirmed until a first code proves the authenticator holds the same secret, so a
 * person who loses their phone halfway through enrolment is not locked out of a panel that
 * thinks they are enrolled. Reading the screen again shows the same secret rather than a new
 * one, because a page that regenerates would never match the authenticator just set up.
 */
export async function startSecondFactorEnrolment(
  db: Queryable,
  keys: MasterKeySource,
  accountId: string,
): Promise<SecondFactorEnrolment> {
  const account = await readAccount(db, accountId);
  if (hasSecondFactor(account)) {
    throw new NxError('NX-4091', { detail: 'this account already has an authenticator' });
  }
  const started = await secretOf(keys, account);
  if (started !== null) {
    return {
      secret: readableSecret(started),
      uri: otpauthUri({ issuer: ISSUER, account: account.email, secret: started }),
    };
  }
  const secret = generateTotpSecret();
  const version = await keys.currentVersion();
  await db.query(
    `UPDATE operator_accounts
     SET totp_secret_enc = $2, totp_key_version = $3, totp_confirmed_at = NULL,
         totp_last_step = NULL, updated_at = now()
     WHERE id = $1`,
    [accountId, sealSecret(await panelKey(keys, version), base32Encode(secret)), version],
  );
  return {
    secret: readableSecret(secret),
    uri: otpauthUri({ issuer: ISSUER, account: account.email, secret }),
  };
}

function newRecoveryCode(): string {
  const bytes = randomBytes(12);
  const letters = [...bytes].map((byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]);
  return (letters.join('').match(/.{1,4}/g) ?? []).join('-');
}

/**
 * The first code from the authenticator, which finishes enrolment.
 *
 * The recovery codes are returned here and nowhere else: they are sealed on the way in, and the
 * only copy in plain text is the one the person is shown once.
 */
export async function confirmSecondFactorEnrolment(
  db: Queryable,
  keys: MasterKeySource,
  accountId: string,
  code: string,
  now: Date = new Date(),
): Promise<{ recoveryCodes: string[] }> {
  const account = await readAccount(db, accountId);
  if (hasSecondFactor(account)) {
    throw new NxError('NX-4091', { detail: 'this account already has an authenticator' });
  }
  const secret = await secretOf(keys, account);
  if (secret === null) {
    throw new NxError('NX-4031', { detail: 'enrolment has not been started' });
  }
  const step = verifyTotp(secret, code, { now });
  if (step === null) {
    throw new NxError('NX-4011', { detail: 'the code does not match' });
  }

  const codes = Array.from({ length: RECOVERY_CODES }, () => newRecoveryCode());
  const sealed: SealedRecoveryCode[] = [];
  for (const value of codes) {
    const seal = await sealPassword(value);
    sealed.push({
      hash: seal.hash.toString('base64'),
      salt: seal.salt.toString('base64'),
      params: seal.params,
      used_at: null,
    });
  }

  await db.query(
    `UPDATE operator_accounts
     SET totp_confirmed_at = $2, totp_last_step = $3, recovery_codes = $4::jsonb, updated_at = now()
     WHERE id = $1`,
    [accountId, now, String(step), JSON.stringify(sealed)],
  );
  await recordOperatorAudit(db, {
    operatorId: accountId,
    action: 'staff.second_factor_enrolled',
    target: `staff:${accountId}`,
  });
  return { recoveryCodes: codes };
}

export type SecondFactorResult = 'CODE' | 'RECOVERY';

/**
 * A code at sign in: from the authenticator, or one of the recovery codes.
 *
 * A code that matches a step this account has already signed in with is refused, which is what
 * makes a code read over a shoulder or taken from a screenshot worthless a moment later. A
 * recovery code works once and says so in the trail, because a person using one has lost their
 * authenticator and somebody should notice.
 */
export async function verifyOperatorSecondFactor(
  db: Queryable,
  keys: MasterKeySource,
  accountId: string,
  code: string,
  now: Date = new Date(),
): Promise<SecondFactorResult> {
  const account = await readAccount(db, accountId);
  if (!hasSecondFactor(account)) {
    throw new NxError('NX-4031', { detail: 'this account has no authenticator yet' });
  }
  const secret = await secretOf(keys, account);
  const lastStep = account.totp_last_step === null ? null : Number(account.totp_last_step);
  const step = secret === null ? null : verifyTotp(secret, code, { now, lastStep });
  if (step !== null) {
    await db.query(
      `UPDATE operator_accounts SET totp_last_step = $2, updated_at = now() WHERE id = $1`,
      [accountId, String(step)],
    );
    return 'CODE';
  }

  const typed = code.trim().toUpperCase();
  const codes = account.recovery_codes ?? [];
  for (const [index, entry] of codes.entries()) {
    if (entry.used_at !== null) {
      continue;
    }
    const matches = await passwordMatches(typed, {
      hash: Buffer.from(entry.hash, 'base64'),
      salt: Buffer.from(entry.salt, 'base64'),
      params: entry.params,
    });
    if (!matches) {
      continue;
    }
    const remaining = codes.map((value, position) =>
      position === index ? { ...value, used_at: now.toISOString() } : value,
    );
    await db.query(
      `UPDATE operator_accounts SET recovery_codes = $2::jsonb, updated_at = now() WHERE id = $1`,
      [accountId, JSON.stringify(remaining)],
    );
    await recordOperatorAudit(db, {
      operatorId: accountId,
      action: 'staff.recovery_code_used',
      target: `staff:${accountId}`,
      metadata: { remaining: remaining.filter((value) => value.used_at === null).length },
    });
    return 'RECOVERY';
  }

  throw new NxError('NX-4011', { detail: 'the code does not match' });
}

/** How many recovery codes an account has left, for the screen that offers new ones. */
export async function recoveryCodesLeft(db: Queryable, accountId: string): Promise<number> {
  const account = await readAccount(db, accountId);
  return (account.recovery_codes ?? []).filter((code) => code.used_at === null).length;
}

/**
 * Taking an authenticator off an account: an owner does it for somebody who lost their phone,
 * and the person signs in next with their password and enrols again.
 *
 * Their sessions fall with it (SEC-04), because a session opened with the old second factor
 * should not outlive it.
 */
export async function resetSecondFactor(
  db: Queryable,
  actor: OperatorIdentity,
  accountId: string,
): Promise<void> {
  if (actor.id !== accountId && !operatorCan(actor.role, 'staff')) {
    throw new NxError('NX-4031', { detail: 'only an owner resets another authenticator' });
  }
  const { rowCount } = await db.query(
    `UPDATE operator_accounts
     SET totp_secret_enc = NULL, totp_key_version = NULL, totp_confirmed_at = NULL,
         totp_last_step = NULL, recovery_codes = '[]'::jsonb,
         credential_version = credential_version + 1, updated_at = now()
     WHERE id = $1`,
    [accountId],
  );
  if ((rowCount ?? 0) === 0) {
    throw new NxError('NX-4041', { detail: 'no such operator account' });
  }
  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'staff.second_factor_reset',
    target: `staff:${accountId}`,
  });
}
