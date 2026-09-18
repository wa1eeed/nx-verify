'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  assertCan,
  addChannel,
  audit,
  proveChannel,
  removeChannel,
  startChannelProof,
  subscribe,
  unsubscribe,
  type IssuedProof,
  type NotificationSeverity,
  type WebhookEventType,
} from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';
import { sendNow } from '../../../../lib/mail';
import { isAddress } from '../../../../lib/share-mail';

/**
 * Adding an address, proving it, and choosing what it is told (ADR-145).
 *
 * The proof is the part that matters. Typing an address into a form claims nothing: a person
 * who mistypes a colleague's address, or types a customer's on purpose, would otherwise have
 * this platform mailing a stranger on their behalf, about customers, forever. So an address
 * receives its first message and nothing else until somebody reads that message.
 *
 * Every step is audited. Who added a recipient for a workspace's alerts, and when, is exactly
 * what gets asked about after the fact.
 */

const HERE = '/settings/notifications';

/** Back to the screen with a word about what happened, and nothing sensitive in the address. */
function back(outcome: string, channelId?: string): never {
  const at = channelId === undefined ? '' : `&channel=${channelId}`;
  redirect(`${HERE}?outcome=${outcome}${at}`);
}

export async function addChannelAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'settings.manage');
  const user = await actingUser();
  const address = String(formData.get('address') ?? '').trim();
  const displayName = String(formData.get('display_name') ?? '').trim();

  if (!isAddress(address)) {
    back('address');
  }

  let channelId: string;
  try {
    channelId = await query(async (tx) => {
      const id = await addChannel(tx, {
        address,
        displayName: displayName === '' ? null : displayName,
      });
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'notification.channel_added',
        target: id,
        // The address is the point of the row. It is a recipient of this workspace's own
        // alerts, not a customer's identifier.
        metadata: { address },
      });
      return id;
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back((error as { code?: string }).code === 'NX-4091' ? 'duplicate' : 'failed');
  }

  await mailProof(channelId, user.userId);
  revalidatePath(HERE);
  back('sent', channelId);
}

/** Sends the code again, for a mail that never arrived or a code that expired. */
export async function resendProofAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'settings.manage');
  const user = await actingUser();
  const channelId = String(formData.get('channel_id') ?? '');
  if (channelId === '') {
    back('failed');
  }
  await mailProof(channelId, user.userId);
  revalidatePath(HERE);
  back('sent', channelId);
}

/**
 * Mails a code, and does not leave a half proved address behind when it cannot.
 *
 * A failure here reads the same as a refusal to the person looking at the screen, because the
 * difference between «our mail service is down» and «that address bounced» is not something a
 * form should teach anyone.
 */
async function mailProof(channelId: string, userId: string): Promise<void> {
  let issued: IssuedProof;
  try {
    issued = await query((tx) => startChannelProof(tx, channelId));
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back((error as { code?: string }).code === 'NX-4029' ? 'too-soon' : 'failed', channelId);
  }

  const sent = await sendNow({
    to: issued.address,
    toName: issued.displayName,
    subject: 'إثبات عنوان للتنبيهات · NX Trust',
    body: [
      `طُلب إرسال تنبيهات NX Trust إلى هذا العنوان.`,
      '',
      `رمز الإثبات: ${issued.code}`,
      '',
      'ينتهي بعد نصف ساعة، ويُستعمل مرة واحدة.',
      '',
      'إن لم تطلب ذلك فلا تفعل شيئاً: لا يُرسل إلى هذا العنوان شيء قبل إدخال الرمز.',
    ].join('\n'),
  });

  if (!sent) {
    back('mail', channelId);
  }

  await query((tx) =>
    audit(tx, {
      actorType: 'USER',
      actorId: userId,
      action: 'notification.proof_sent',
      target: channelId,
      metadata: { address: issued.address },
    }),
  );
}

export async function proveChannelAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'settings.manage');
  const user = await actingUser();
  const channelId = String(formData.get('channel_id') ?? '');
  const code = String(formData.get('code') ?? '').trim();
  if (channelId === '' || code === '') {
    back('code', channelId);
  }

  try {
    await query(async (tx) => {
      await proveChannel(tx, { channelId, code });
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'notification.channel_proved',
        target: channelId,
        metadata: {},
      });
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back('code', channelId);
  }

  revalidatePath(HERE);
  back('proved');
}

export async function removeChannelAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'settings.manage');
  const user = await actingUser();
  const channelId = String(formData.get('channel_id') ?? '');
  if (channelId === '') {
    back('failed');
  }

  await query(async (tx) => {
    await removeChannel(tx, channelId);
    await audit(tx, {
      actorType: 'USER',
      actorId: user.userId,
      action: 'notification.channel_removed',
      target: channelId,
      metadata: {},
    });
  });

  revalidatePath(HERE);
  back('removed');
}

export async function subscribeAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'settings.manage');
  const user = await actingUser();
  const channelId = String(formData.get('channel_id') ?? '');
  const eventType = String(formData.get('event_type') ?? '');
  const minSeverity = String(formData.get('min_severity') ?? 'INFO') as NotificationSeverity;
  if (channelId === '' || eventType === '') {
    back('failed');
  }

  try {
    await query(async (tx) => {
      const ruleId = await subscribe(tx, {
        channelId,
        eventType: eventType as WebhookEventType,
        minSeverity,
      });
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'notification.subscribed',
        target: ruleId,
        metadata: { event_type: eventType, min_severity: minSeverity },
      });
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back('failed');
  }

  revalidatePath(HERE);
  back('subscribed');
}

export async function unsubscribeAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'settings.manage');
  const user = await actingUser();
  const ruleId = String(formData.get('rule_id') ?? '');
  if (ruleId === '') {
    back('failed');
  }

  await query(async (tx) => {
    await unsubscribe(tx, ruleId);
    await audit(tx, {
      actorType: 'USER',
      actorId: user.userId,
      action: 'notification.unsubscribed',
      target: ruleId,
      metadata: {},
    });
  });

  revalidatePath(HERE);
  back('unsubscribed');
}

/** A redirect inside a try is a thrown value, not a failure: it has to travel. */
function isRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
