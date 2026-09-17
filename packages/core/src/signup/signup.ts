import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import { createUser } from '../auth/users.js';
import { setPassword } from '../auth/passwords.js';
import { ensureWallet } from '../billing/wallet.js';
import { audit } from '../auth/audit.js';

/**
 * A company signing itself up (ADR-154).
 *
 * Deferred until now for one stated reason: registration without proving an address is an
 * abuse surface rather than a feature. The platform can send mail since ADR-141, so it is
 * buildable, and this is the shape it takes.
 *
 * **No workspace exists until the address is proved.** The alternative, a tenant row marked
 * pending, leaves a half made workspace behind for every abandoned form and needs a sweep to
 * clear them, and a tenant row is the thing everything else in this platform hangs from.
 *
 * What stops abuse afterwards is not this file: it is the wallet. A new workspace has no
 * balance and no verification runs without one, so a hundred registrations are a hundred empty
 * workspaces that have cost nothing. The registration gate keeps out robots; the wallet keeps
 * out everybody who has not paid.
 */

const CODE_DIGITS = 6;
export const MAX_SIGNUP_ATTEMPTS = 5;
export const SIGNUP_TTL_MINUTES = 30;
export const SIGNUP_RESEND_AFTER_SECONDS = 60;

/**
 * The scope the answers are sealed under.
 *
 * There is no tenant yet, so there is no per tenant key. A constant derives a stable key from
 * the platform's root for this one purpose and for nothing else: an intent opened with it
 * reveals a company's own registration form, never another workspace's data.
 *
 * It is shaped as a uuid because the key provider takes one, and it is a **nil-prefixed
 * constant nothing can ever be allocated as**: `gen_random_uuid()` will not produce it, so
 * this scope can never collide with a real workspace's key.
 */
const SIGNUP_SCOPE = '00000000-0000-0000-0000-00000000513d';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 1;

/** What the registration form asks, beyond the address the code goes to. */
export interface SignupAnswers {
  /** The establishment, as it is registered. */
  legalName: string;
  /** What it does, in its own words. Not a coded list: we are not the authority on that. */
  activity: string;
  /** The unified number or commercial registration. An identifier, so it is sealed. */
  unifiedNumber: string;
  contactName: string;
  phone: string;
}

export interface StartSignupInput extends SignupAnswers {
  email: string;
  password: string;
  ip?: string | null;
}

export interface StartedSignup {
  intentId: string;
  /** The six digits. Returned once, to be mailed and then forgotten. */
  code: string;
  email: string;
  expiresAt: Date;
}

function digestOfCode(intentId: string, code: string): Buffer {
  return createHash('sha256').update(`${intentId}:${code}`).digest();
}

function sixDigits(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
}

function seal(key: Buffer, value: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.of(VERSION), iv, cipher.getAuthTag(), body]);
}

function open(key: Buffer, payload: Buffer): string {
  if (payload.length < 1 + IV_BYTES + TAG_BYTES || payload[0] !== VERSION) {
    throw new NxError('NX-5001', { detail: 'the sealed registration is malformed' });
  }
  const iv = payload.subarray(1, 1 + IV_BYTES);
  const tag = payload.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(payload.subarray(1 + IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}

/** A workspace name from the company's own, unique enough to be a subdomain one day. */
export function slugFrom(legalName: string): string {
  const latin = legalName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 28)
    .replace(/^-+|-+$/g, '');
  // An Arabic name leaves nothing behind, which is the common case here rather than the
  // exception. A readable prefix and random digits beat a slug nobody can type either way.
  const stem = latin.length >= 3 ? latin : 'nx';
  return `${stem}-${randomBytes(3).toString('hex')}`;
}

function assertAnswers(input: StartSignupInput): void {
  const bad = (detail: string, cause: string): never => {
    throw new NxError('NX-4002', { detail, cause });
  };
  if (input.legalName.trim().length < 2 || input.legalName.trim().length > 120) {
    bad('a legal name is 2 to 120 characters', 'اسم المنشأة من حرفين إلى 120.');
  }
  if (input.activity.trim().length < 2 || input.activity.trim().length > 120) {
    bad('an activity is 2 to 120 characters', 'اكتب نوع النشاط.');
  }
  if (!/^\d{10}$/.test(input.unifiedNumber.trim())) {
    bad('a unified number is ten digits', 'الرقم الموحد عشرة أرقام.');
  }
  if (input.contactName.trim().length < 2) {
    bad('a contact name is needed', 'اكتب اسم مسؤول الحساب.');
  }
  if (!/^(?:\+?966|0)?5\d{8}$/.test(input.phone.trim().replace(/[\s-]/g, ''))) {
    bad('a Saudi mobile number is needed', 'رقم جوال سعودي، مثل 05xxxxxxxx.');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim()) || input.email.length > 200) {
    bad('the email is malformed', 'راجع البريد المكتوب.');
  }
  if (input.password.length < 12) {
    bad('a password is at least twelve characters', 'كلمة المرور 12 حرفاً على الأقل.');
  }
}

/**
 * Takes the answers and sends a code. Creates nothing else.
 *
 * Asking again for the same address replaces what was waiting, and asking again inside a
 * minute is refused, so the form cannot be turned into a way to send somebody mail.
 */
export async function startSignup(
  db: Queryable,
  keys: TenantKeyProvider,
  input: StartSignupInput,
): Promise<StartedSignup> {
  assertAnswers(input);
  const email = input.email.trim().toLowerCase();

  const { rows: recent } = await db.query<{ created_at: Date }>(
    `SELECT created_at FROM signup_intents
      WHERE lower(email) = $1 AND consumed_at IS NULL`,
    [email],
  );
  const last = recent[0]?.created_at;
  if (last !== undefined && Date.now() - last.getTime() < SIGNUP_RESEND_AFTER_SECONDS * 1_000) {
    throw new NxError('NX-4029', {
      detail: 'a code was sent moments ago',
      cause: 'أُرسل رمز قبل قليل. انتظر دقيقة ثم اطلب غيره.',
    });
  }

  // An address that already signs in somewhere is not told so here. A registration form that
  // says «this address has an account» is a way to ask whether a company is a customer.
  const intentId = randomUUID();
  const code = sixDigits();
  const expiresAt = new Date(Date.now() + SIGNUP_TTL_MINUTES * 60_000);
  const version = await keys.currentVersion();
  const key = await keys.encryptionKey(SIGNUP_SCOPE, version);

  const answers: SignupAnswers & { password: string } = {
    legalName: input.legalName.trim(),
    activity: input.activity.trim(),
    unifiedNumber: input.unifiedNumber.trim(),
    contactName: input.contactName.trim(),
    phone: input.phone.trim().replace(/[\s-]/g, ''),
    password: input.password,
  };

  await db.query(`DELETE FROM signup_intents WHERE lower(email) = $1 AND consumed_at IS NULL`, [
    email,
  ]);
  await db.query(
    `INSERT INTO signup_intents (id, email, payload_enc, key_version, code_hash, expires_at, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      intentId,
      email,
      seal(key, JSON.stringify(answers)),
      version,
      digestOfCode(intentId, code),
      expiresAt,
      input.ip ?? null,
    ],
  );

  return { intentId, code, email, expiresAt };
}

export interface CompletedSignup {
  tenantId: string;
  slug: string;
  email: string;
  userId: string;
  answers: SignupAnswers;
}

/**
 * Spends the code and makes the workspace.
 *
 * Every refusal is the same refusal, for the reason six digits exist at all. The workspace and
 * its first administrator are written under the new tenant's own scope, the same path
 * «مشترك جديد» takes, so a tenant row is never created by a role that crosses subscribers.
 *
 * No plan and no balance are granted here. That is the gate: the company can sign in, see what
 * the platform offers and ask to buy, and can run nothing until somebody confirms their
 * transfer.
 */
export async function completeSignup(
  db: Queryable,
  inTenant: <T>(tenantId: string, handler: (tx: TenantTransaction) => Promise<T>) => Promise<T>,
  keys: TenantKeyProvider,
  input: { intentId: string; code: string },
): Promise<CompletedSignup> {
  const refuse = (): never => {
    throw new NxError('NX-4011', {
      detail: 'the code is wrong, spent or expired',
      cause: 'الرمز غير صحيح أو انتهت مدته.',
    });
  };

  const { rows } = await db.query<{
    id: string;
    email: string;
    payload_enc: Buffer;
    key_version: number;
    code_hash: Buffer;
    attempts: number;
    expires_at: Date;
    consumed_at: Date | null;
  }>(
    `SELECT id, email, payload_enc, key_version, code_hash, attempts, expires_at, consumed_at
       FROM signup_intents WHERE id = $1`,
    [input.intentId],
  );

  const intent = rows[0];
  if (
    intent === undefined ||
    intent.consumed_at !== null ||
    intent.expires_at.getTime() <= Date.now() ||
    intent.attempts >= MAX_SIGNUP_ATTEMPTS
  ) {
    return refuse();
  }

  const offered = digestOfCode(intent.id, input.code.trim());
  const matches =
    offered.length === intent.code_hash.length && timingSafeEqual(offered, intent.code_hash);
  if (!matches) {
    await db.query(`UPDATE signup_intents SET attempts = attempts + 1 WHERE id = $1`, [intent.id]);
    return refuse();
  }

  const key = await keys.encryptionKey(SIGNUP_SCOPE, intent.key_version);
  const answers = JSON.parse(open(key, intent.payload_enc)) as SignupAnswers & {
    password: string;
  };

  const tenantId = randomUUID();
  let slug = slugFrom(answers.legalName);
  let userId = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      userId = await inTenant(tenantId, async (tx) => {
        await tx.query(`INSERT INTO tenants (id, legal_name, slug) VALUES ($1, $2, $3)`, [
          tenantId,
          answers.legalName,
          slug,
        ]);
        const id = await createUser(tx, {
          email: intent.email,
          displayName: answers.contactName,
          role: 'ADMIN',
        });
        // Their own password, chosen on the form, so nothing temporary is ever mailed.
        await setPassword(tx, { userId: id, password: answers.password, mustChange: false });
        // A wallet with nothing in it. Without the row every screen that reads a balance
        // throws instead of saying «zero», and «zero» is the whole message a new subscriber
        // needs: nothing runs until somebody funds this.
        await ensureWallet(tx);
        // How this workspace came to exist, in the one place that question belongs. The
        // intent itself holds no tenant id: a column like that would make a pre-tenant table
        // look tenant scoped to guard 02, which is right to insist.
        await audit(tx, {
          actorType: 'SYSTEM',
          actorId: 'signup',
          action: 'tenant.registered',
          target: tenantId,
          metadata: { activity: answers.activity, intent: intent.id },
        });
        return id;
      });
      break;
    } catch (error) {
      if ((error as { code?: string }).code === '23505' && attempt < 2) {
        slug = slugFrom(answers.legalName);
        continue;
      }
      throw error;
    }
  }

  await db.query(
    `UPDATE signup_intents SET consumed_at = now(), attempts = attempts + 1 WHERE id = $1`,
    [intent.id],
  );

  return {
    tenantId,
    slug,
    email: intent.email,
    userId,
    answers: {
      legalName: answers.legalName,
      activity: answers.activity,
      unifiedNumber: answers.unifiedNumber,
      contactName: answers.contactName,
      phone: answers.phone,
    },
  };
}

/** Clears what was abandoned or spent. Called by the retention sweep. */
export async function pruneSignupIntents(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM signup_intents
      WHERE expires_at < now() - interval '1 day' OR consumed_at < now() - interval '7 days'`,
  );
  return rowCount ?? 0;
}
