import type { Queryable } from '@nx-verify/db';
import { NxError } from '../errors.js';

/**
 * How mail leaves this deployment, set from the panel (ADR-141).
 *
 * The transport has always been a seam and the queue behind it has always worked; what was
 * missing was a way to point it at a mail service without a deployment and a restart. That is
 * all this is: the address, the name and which service carries it become a row.
 *
 * The key does not. Rule 10 is not relaxed for mail: what is stored here is a `kms://`
 * reference and the material stays in the secret store, exactly as a provider's credential
 * does. Nothing on this surface returns it, and `hasKey` is the only thing a screen is told.
 */

export type MailProvider = 'none' | 'resend' | 'http';

export interface MailSettings {
  provider: MailProvider;
  fromAddress: string | null;
  fromName: string | null;
  replyTo: string | null;
  endpoint: string | null;
  /** Where the secret store holds the key. Never the key. */
  credentialRef: string | null;
  /** Whether a key has been stored at all. The value is never read on this path. */
  hasKey: boolean;
  /** True when a message could actually leave: a provider, an address and a key. */
  configured: boolean;
  lastSentAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function getMailSettings(db: Queryable): Promise<MailSettings> {
  const { rows } = await db.query<{
    provider: MailProvider;
    from_address: string | null;
    from_name: string | null;
    reply_to: string | null;
    endpoint: string | null;
    credential_ref: string | null;
    last_sent_at: Date | null;
    last_error: string | null;
    updated_at: Date;
    updated_by: string | null;
  }>(
    `SELECT provider, from_address, from_name, reply_to, endpoint, credential_ref,
            last_sent_at, last_error, updated_at, updated_by
       FROM mail_settings WHERE id = true`,
  );
  const row = rows[0];
  if (!row) {
    // A deployment whose settings row is missing sends nothing, rather than falling back to
    // a default that would send as somebody.
    return {
      provider: 'none',
      fromAddress: null,
      fromName: null,
      replyTo: null,
      endpoint: null,
      credentialRef: null,
      hasKey: false,
      configured: false,
      lastSentAt: null,
      lastError: null,
      updatedAt: new Date(0),
      updatedBy: null,
    };
  }
  return {
    provider: row.provider,
    fromAddress: row.from_address,
    fromName: row.from_name,
    replyTo: row.reply_to,
    endpoint: row.endpoint,
    credentialRef: row.credential_ref,
    hasKey: row.credential_ref !== null,
    configured: row.provider !== 'none' && row.from_address !== null && row.credential_ref !== null,
    lastSentAt: row.last_sent_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export interface SetMailSettingsInput {
  provider: MailProvider;
  fromAddress?: string | null;
  fromName?: string | null;
  replyTo?: string | null;
  endpoint?: string | null;
  /** Given only when a key was just written to the store. Absent keeps the one in force. */
  credentialRef?: string | null;
}

function refuse(detail: string, cause: string): never {
  throw new NxError('NX-4002', { detail, cause });
}

/**
 * Points the platform at a mail service, or takes it off one.
 *
 * Choosing `none` clears the address and the reference with it, because a half configured
 * transport is the one failure mode worth designing out: it queues messages that can never
 * leave and reports nothing wrong while doing it.
 */
export async function setMailSettings(
  operator: Queryable,
  input: SetMailSettingsInput,
  actorId: string,
): Promise<void> {
  const trimmed = (value: string | null | undefined): string | null => {
    const text = (value ?? '').trim();
    return text === '' ? null : text;
  };
  const fromAddress = trimmed(input.fromAddress);
  const replyTo = trimmed(input.replyTo);
  const endpoint = trimmed(input.endpoint);
  const fromName = trimmed(input.fromName);

  if (input.provider === 'none') {
    await operator.query(
      `UPDATE mail_settings
          SET provider = 'none', from_address = NULL, from_name = NULL, reply_to = NULL,
              endpoint = NULL, credential_ref = NULL, last_error = NULL,
              updated_at = now(), updated_by = $1
        WHERE id = true`,
      [actorId],
    );
    await audit(operator, actorId, { provider: 'none' });
    return;
  }

  if (fromAddress === null || !EMAIL.test(fromAddress)) {
    refuse('from address is not an address', 'عنوان المرسِل غير صالح.');
  }
  if (replyTo !== null && !EMAIL.test(replyTo)) {
    refuse('reply-to is not an address', 'عنوان الرد غير صالح.');
  }
  if (input.provider === 'http' && (endpoint === null || !endpoint.startsWith('https://'))) {
    refuse('an http transport needs an https endpoint', 'الخدمة تحتاج عنواناً يبدأ بـ https.');
  }
  if (input.credentialRef !== undefined && input.credentialRef !== null) {
    if (!input.credentialRef.startsWith('kms://')) {
      refuse('the credential must be a kms reference', 'المفتاح يُخزَّن في خزنة الأسرار لا هنا.');
    }
  }

  const { rowCount } = await operator.query(
    `UPDATE mail_settings
        SET provider = $1,
            from_address = $2,
            from_name = $3,
            reply_to = $4,
            endpoint = $5,
            credential_ref = COALESCE($6, credential_ref),
            last_error = NULL,
            updated_at = now(),
            updated_by = $7
      WHERE id = true`,
    [
      input.provider,
      fromAddress,
      fromName,
      replyTo,
      input.provider === 'http' ? endpoint : null,
      input.credentialRef ?? null,
      actorId,
    ],
  );
  if ((rowCount ?? 0) === 0) {
    throw new NxError('NX-5001', { detail: 'mail settings row is missing' });
  }
  await audit(operator, actorId, {
    provider: input.provider,
    from_address: fromAddress,
    key_changed: input.credentialRef != null,
  });
}

/** Which fields, and the address they send from. Never the key (rule 10). */
async function audit(
  operator: Queryable,
  actorId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await operator.query(
    `INSERT INTO operator_audit (operator_id, action, target, metadata)
     VALUES ($1, 'mail.settings_set', 'mail', $2::jsonb)`,
    [actorId, JSON.stringify(metadata)],
  );
}

/**
 * What the last attempt did, written by whoever sent.
 *
 * So the panel can say «it works» from a real send rather than from a saved form. The error is
 * the transport's own sentence, held short and never carrying a recipient: a mail service that
 * echoes an address back in an error would otherwise put it in our settings table.
 */
export async function recordMailResult(
  db: Queryable,
  result: { ok: boolean; error?: string | undefined },
): Promise<void> {
  await db.query(
    `UPDATE mail_settings
        SET last_sent_at = CASE WHEN $1 THEN now() ELSE last_sent_at END,
            last_error = CASE WHEN $1 THEN NULL ELSE left($2, 300) END
      WHERE id = true`,
    [result.ok, result.error ?? 'send failed'],
  );
}
