import {
  claimPendingNotifications,
  recordNotificationResult,
  type PendingNotification,
} from '@nx-verify/core';
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

export interface OutgoingMail {
  to: string;
  toName: string | null;
  subject: string;
  body: string;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<{ ok: boolean; error?: string }>;
}

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
    });
  } catch (error) {
    // A transport that throws is a transport that failed, and the message is ours to
    // record rather than to raise into the job loop.
    return { ok: false, error: error instanceof Error ? error.message : 'send failed' };
  }
}

/** For local work and tests. Keeps what it was asked to send and sends nothing. */
export class CollectingMailTransport implements MailTransport {
  readonly sent: OutgoingMail[] = [];

  send(mail: OutgoingMail): Promise<{ ok: boolean }> {
    this.sent.push(mail);
    return Promise.resolve({ ok: true });
  }
}

/**
 * Mail over an HTTP API.
 *
 * The one transport shipped here, because it needs no dependency and every hosted mail
 * service offers one. SMTP needs a client library and a relay, and both are deployment
 * choices rather than product ones, so an SMTP transport implements this same interface
 * wherever a deployment wants it.
 *
 * The endpoint and the token come from the environment of the process, never from the
 * database (rule 10).
 */
export class HttpMailTransport implements MailTransport {
  readonly #endpoint: string;
  readonly #token: string;
  readonly #from: string;

  constructor(options: { endpoint: string; token: string; from: string }) {
    this.#endpoint = options.endpoint;
    this.#token = options.token;
    this.#from = options.from;
  }

  static fromEnv(): HttpMailTransport {
    const endpoint = process.env['NX_MAIL_ENDPOINT'];
    const token = process.env['NX_MAIL_TOKEN'];
    const from = process.env['NX_MAIL_FROM'];
    if (!endpoint || !token || !from) {
      throw new Error('NX_MAIL_ENDPOINT, NX_MAIL_TOKEN and NX_MAIL_FROM are required');
    }
    return new HttpMailTransport({ endpoint, token, from });
  }

  async send(mail: OutgoingMail): Promise<{ ok: boolean; error?: string }> {
    const response = await fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.#from,
        to: mail.to,
        to_name: mail.toName,
        subject: mail.subject,
        text: mail.body,
      }),
    });

    if (response.ok) {
      return { ok: true };
    }
    // The status, not the body. A mail service that echoes the recipient back in an error
    // would otherwise put it in our logs.
    return { ok: false, error: `mail endpoint answered ${response.status}` };
  }
}
