'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { assertCan, audit, registerEndpoint, setEndpointStatus } from '@nx-verify/core';
import { secretStoreFromEnv } from '@nx-verify/providers';
import { actingUser, currentTenantId, query } from '../../../../../lib/context';
import type { IssuedSecretState } from '../../../../../components/webhooks';

/**
 * Registering an address for us to call (ADR-147).
 *
 * The whole delivery pipeline has been built since the webhooks unit: events are queued on
 * every completed verification, signed, retried with a backoff and abandoned after the last
 * attempt. It ran against a permanently empty endpoint table, because `registerEndpoint` had
 * no caller anywhere and the tab was named «مفاتيح الربط والـ Webhooks» while offering only
 * API keys. No subscriber could ever receive one.
 *
 * **We generate the signing secret, not the subscriber.** It is what signs every delivery,
 * so its quality is our problem, not something to leave to whatever somebody types into a
 * box. It goes to the sealed store and the row keeps only a `kms://` reference (rule 10),
 * and it is shown once, here, and never again: the whole point of the signature is that only
 * two parties hold it.
 */

/** Where an endpoint's secret lives. Random rather than derived from the id, which we do
 *  not have until the row exists. */
function refFor(tenantId: string): string {
  return `kms://tenants/${tenantId}/webhooks/${randomBytes(8).toString('hex')}`;
}

export async function addEndpointAction(
  _previous: IssuedSecretState,
  formData: FormData,
): Promise<IssuedSecretState> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'developers.manage');
  const user = await actingUser();
  const tenantId = await currentTenantId();
  const url = String(formData.get('url') ?? '').trim();
  const events = formData.getAll('events').map((value) => String(value));

  if (!url.startsWith('https://')) {
    // The table refuses it too. Saying so here is the difference between a message and a
    // stack trace: we call this address, so plain HTTP would put a signed payload about a
    // customer on the wire in the clear.
    return { secret: null, refused: 'url' };
  }
  if (events.length === 0) {
    return { secret: null, refused: 'events' };
  }

  const store = secretStoreFromEnv();
  if (!store.writable || !store.put) {
    return { secret: null, refused: 'readonly' };
  }

  const signingSecret = randomBytes(32).toString('base64url');
  const secretRef = refFor(tenantId);
  await store.put(secretRef, { signingSecret });

  try {
    await query(async (tx) => {
      const endpointId = await registerEndpoint(tx, { url, secretRef, events });
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'webhook.registered',
        target: endpointId,
        // The address and what it subscribed to. Never the secret, and never the reference
        // either: a pointer in an audit row is one lookup away from the thing it points at.
        metadata: { url, events },
      });
    });
  } catch {
    return { secret: null, refused: 'failed' };
  }

  revalidatePath('/settings/developers/webhooks');
  // Once. There is no way to read it back, from this screen or from the database.
  return { secret: signingSecret, refused: null };
}

export async function pauseEndpointAction(formData: FormData): Promise<void> {
  await setStatus(formData, 'paused', 'webhook.paused');
}

export async function resumeEndpointAction(formData: FormData): Promise<void> {
  await setStatus(formData, 'active', 'webhook.resumed');
}

async function setStatus(
  formData: FormData,
  status: 'active' | 'paused',
  action: string,
): Promise<void> {
  // Here rather than in each caller: pausing had no check while resuming did, and pausing is
  // the destructive half. A guard that each wrapper must remember is a guard one will forget.
  const user = await actingUser();
  assertCan(user.capabilities, 'developers.manage');
  const endpointId = String(formData.get('endpoint_id') ?? '');
  if (endpointId === '') {
    return;
  }

  await query(async (tx) => {
    await setEndpointStatus(tx, endpointId, status);
    await audit(tx, {
      actorType: 'USER',
      actorId: user.userId,
      action,
      target: endpointId,
      metadata: {},
    });
  });

  revalidatePath('/settings/developers/webhooks');
}
