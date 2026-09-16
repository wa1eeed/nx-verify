'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  NxError,
  getMailSettings,
  recordMailResult,
  setMailSettings,
  type MailProvider,
} from '@nx-verify/core';
import { HttpMailTransport, ResendMailTransport, secretStoreFromEnv } from '@nx-verify/providers';
import { operatorQuery, requireOperatorPermission } from '../../../../../lib/operator';

/**
 * Setting how mail leaves, and proving it (ADR-141).
 *
 * The key goes to the secret store and nowhere else; the settings row holds a `kms://` pointer
 * (rule 10). A key field left empty keeps what is stored, so correcting an address never means
 * pasting the key again, and no redirect ever carries a value (SEC-10).
 */

const CREDENTIAL_REF = 'kms://platform/mail';

function back(params: Record<string, string>): never {
  redirect(`/operator/verification/mail?${new URLSearchParams(params).toString()}`);
}

export async function saveMailAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('integration');
  const provider = String(formData.get('provider') ?? 'none') as MailProvider;
  const apiKey = String(formData.get('api_key') ?? '').trim();

  const store = secretStoreFromEnv();
  if (apiKey !== '' && (!store.writable || !store.put)) {
    back({ refused: 'readonly' });
  }

  let credentialRef: string | undefined;
  if (apiKey !== '') {
    await store.put?.(CREDENTIAL_REF, { apiKey });
    credentialRef = CREDENTIAL_REF;
  } else if (provider !== 'none') {
    // No key typed and none stored is a transport that would queue messages it can never
    // send, which the settings table refuses as well.
    const current = await operatorQuery((db) => getMailSettings(db));
    if (!current.hasKey) {
      back({ refused: 'invalid' });
    }
  }

  try {
    await operatorQuery((db) =>
      setMailSettings(
        db,
        {
          provider,
          fromAddress: String(formData.get('from_address') ?? ''),
          fromName: String(formData.get('from_name') ?? ''),
          replyTo: String(formData.get('reply_to') ?? ''),
          endpoint: String(formData.get('endpoint') ?? ''),
          ...(credentialRef === undefined ? {} : { credentialRef }),
        },
        actor.id,
      ),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    back({ refused: 'invalid' });
  }
  revalidatePath('/operator/verification/mail');
  back({ saved: provider === 'none' ? 'cleared' : 'saved' });
}

/**
 * One message, through the same transport the worker delivers with.
 *
 * What proves a setting is a message that arrived, not a form that saved. The result is
 * written to the settings row, so the screen says what happened without holding it in a
 * redirect.
 */
export async function testMailAction(formData: FormData): Promise<void> {
  await requireOperatorPermission('integration');
  const to = String(formData.get('to') ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    back({ refused: 'invalid' });
  }

  const settings = await operatorQuery((db) => getMailSettings(db));
  if (!settings.configured || settings.credentialRef === null || settings.fromAddress === null) {
    back({ refused: 'invalid' });
  }
  const material = await secretStoreFromEnv()
    .fetch(settings.credentialRef)
    .catch(() => null);
  const key = material?.['apiKey'] ?? '';
  if (key === '') {
    back({ refused: 'invalid' });
  }

  const from =
    settings.fromName === null
      ? settings.fromAddress
      : `${settings.fromName} <${settings.fromAddress}>`;
  const transport =
    settings.provider === 'resend'
      ? new ResendMailTransport({ key, from, replyTo: settings.replyTo })
      : new HttpMailTransport({ endpoint: settings.endpoint ?? '', token: key, from });

  const result = await transport.send({
    to,
    toName: null,
    subject: 'رسالة تجربة من منصة NX Trust',
    body: 'وصلتك هذه الرسالة لأن أحداً في لوحة الإدارة جرّب ضبط البريد.\n\nلا إجراء مطلوب منك.',
  });
  await operatorQuery((db) => recordMailResult(db, result));
  revalidatePath('/operator/verification/mail');
  back(result.ok ? { saved: 'sent' } : { refused: 'send' });
}
