import { getMailSettings, recordMailResult, type MailSettings } from '@nx-verify/core';
import {
  HttpMailTransport,
  ResendMailTransport,
  secretStoreFromEnv,
  type MailTransport,
  type OutgoingMail,
} from '@nx-verify/providers';
import { operatorQuery } from './operator';

/**
 * Sending one message from a screen rather than from the queue (ADR-143).
 *
 * The queue is right for everything that can wait a minute, which is almost everything. A
 * sign in code cannot: somebody is looking at a form. So this is the one path that sends
 * directly, through the same transport the worker delivers with.
 *
 * It reads the settings on the operator connection because `mail_settings` is one row for the
 * platform and has no tenant. Nothing about the message is stored: the queue's tables hold a
 * subject and a body, and a live sign in code has no business being in a table anybody reads.
 */

async function transportFor(settings: MailSettings): Promise<MailTransport | null> {
  if (!settings.configured || settings.credentialRef === null || settings.fromAddress === null) {
    return null;
  }
  const material = await secretStoreFromEnv()
    .fetch(settings.credentialRef)
    .catch(() => null);
  const key = material?.['apiKey'] ?? '';
  if (key === '') {
    return null;
  }
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

/**
 * True when the message left.
 *
 * False covers both «nothing is configured» and «the service refused», deliberately: the
 * caller's answer to either is the same, and a sign in screen that distinguishes them tells a
 * stranger about our deployment.
 */
export async function sendNow(mail: OutgoingMail): Promise<boolean> {
  const settings = await operatorQuery((db) => getMailSettings(db));
  const transport = await transportFor(settings);
  if (transport === null) {
    return false;
  }
  const result = await transport.send(mail);
  await operatorQuery((db) => recordMailResult(db, result));
  return result.ok;
}
