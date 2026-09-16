import {
  claimPendingNotifications,
  recordNotificationResult,
  type PendingNotification,
} from '@nx-verify/core';
import type { MailSettings } from '@nx-verify/core';
import { HttpMailTransport, ResendMailTransport, type MailTransport } from '@nx-verify/providers';
import type { TenantTransaction } from '@nx-verify/db';

/**
 * Sending the queued messages.
 *
 * The transport is a seam, like the providers and the key store, because how mail leaves
 * a deployment is a deployment decision: a relay in one place, a hosted API in another.
 * Nothing above this line knows which.
 *
 * Failures back off on the same schedule as webhook deliveries and then give up. A mail
 * server that has refused for a day will not be persuaded by attempt two hundred, and the
 * message stays readable in the console either way.
 */

export interface DeliverNotificationsOptions {
  transport: MailTransport;
  limit?: number;
}

export interface NotificationSummary {
  deliveryId: string;
  ok: boolean;
}

export async function deliverNotifications(
  tx: TenantTransaction,
  options: DeliverNotificationsOptions,
): Promise<NotificationSummary[]> {
  const pending = await claimPendingNotifications(tx, options.limit ?? 50);
  const summaries: NotificationSummary[] = [];

  for (const delivery of pending) {
    const result = await send(options.transport, delivery);
    await recordNotificationResult(tx, delivery.id, {
      ok: result.ok,
      ...(result.error === undefined ? {} : { error: result.error }),
    });
    summaries.push({ deliveryId: delivery.id, ok: result.ok });
  }

  return summaries;
}

async function send(
  transport: MailTransport,
  delivery: PendingNotification,
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await transport.send({
      to: delivery.address,
      toName: delivery.displayName,
      subject: delivery.subject,
      body: delivery.body,
      // The delivery's own id: a sweep retried after a timeout must not put the same message
      // in somebody's inbox a second time.
      idempotencyKey: delivery.id,
    });
  } catch (error) {
    // A transport that throws is a transport that failed, and the message is ours to
    // record rather than to raise into the job loop.
    return { ok: false, error: error instanceof Error ? error.message : 'send failed' };
  }
}

/**
 * The transport a deployment's settings ask for, with its key fetched from the secret store.
 *
 * Returns null when nothing is configured, which is the ordinary state of a fresh deployment
 * and not an error: messages queue where the console can still show them, and the job that
 * calls this does nothing until somebody sets an address and a key in the panel.
 *
 * A key that cannot be fetched is also null rather than a throw. A secret store that is down
 * must not take the worker's whole sweep with it, and the settings row records what happened.
 */
export async function buildMailTransport(
  settings: MailSettings,
  secrets: { fetch(ref: string): Promise<Readonly<Record<string, string>>> },
): Promise<MailTransport | null> {
  if (!settings.configured || settings.credentialRef === null || settings.fromAddress === null) {
    return null;
  }
  const material = await secrets.fetch(settings.credentialRef).catch(() => null);
  const key = material?.['apiKey'] ?? material?.['token'] ?? '';
  if (key === '') {
    return null;
  }
  // «الاسم <العنوان>» when a name is set, because a message from a bare address is one a
  // reader has to decode before deciding whether to open it.
  const from =
    settings.fromName === null
      ? settings.fromAddress
      : `${settings.fromName} <${settings.fromAddress}>`;

  if (settings.provider === 'resend') {
    return new ResendMailTransport({ key, from, replyTo: settings.replyTo });
  }
  if (settings.provider === 'http' && settings.endpoint !== null) {
    return new HttpMailTransport({ endpoint: settings.endpoint, token: key, from });
  }
  return null;
}

export {
  CollectingMailTransport,
  HttpMailTransport,
  ResendMailTransport,
} from '@nx-verify/providers';
export type { MailTransport, OutgoingMail } from '@nx-verify/providers';
