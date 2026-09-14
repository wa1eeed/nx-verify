'use server';

import { redirect } from 'next/navigation';
import { setCallback } from '@nx-verify/core';
import { PRIMARY_PROVIDER } from '@nx-verify/db';
import {
  listProviderConnections,
  recordConnectionTest,
  recordOperatorChange,
  secretStoreFromEnv,
  setProviderConnection,
  testClientCredentials,
} from '@nx-verify/providers';
import { operatorQuery, requireOperatorPermission } from '../../../../../lib/operator';

/**
 * Saving and testing the connection to the data source, from the panel.
 *
 * The material goes to the secret store and nowhere else. The connection row holds the
 * reference, the operator trail names which fields changed, and no table, log line or
 * redirect ever carries a value (rule 10). A secret field left empty keeps what is stored,
 * so correcting an address never means pasting the secret again.
 */

type Environment = 'sandbox' | 'live';

function environmentOf(formData: FormData): Environment {
  return String(formData.get('environment') ?? '') === 'live' ? 'live' : 'sandbox';
}

function back(environment: Environment, outcome: string): never {
  redirect(`/operator/verification/integration?env=${environment}&${outcome}`);
}

function credentialRefFor(environment: Environment): string {
  return `kms://providers/${PRIMARY_PROVIDER}/${environment}`;
}

function validUrl(value: string, environment: Environment): boolean {
  try {
    const url = new URL(value);
    // Production speaks to the data source over TLS and nothing else.
    return environment === 'live'
      ? url.protocol === 'https:'
      : ['https:', 'http:'].includes(url.protocol);
  } catch {
    return false;
  }
}

export async function saveIntegrationAction(formData: FormData): Promise<void> {
  const { id: operatorId } = await requireOperatorPermission('integration');
  const environment = environmentOf(formData);

  const clientId = String(formData.get('client_id') ?? '').trim();
  const clientSecret = String(formData.get('client_secret') ?? '').trim();
  const webhookSecret = String(formData.get('webhook_secret') ?? '').trim();
  const baseUrl = String(formData.get('base_url') ?? '').trim();
  const authUrl = String(formData.get('auth_url') ?? '').trim();

  if (!validUrl(baseUrl, environment) || !validUrl(authUrl, environment)) {
    back(environment, 'error=url');
  }

  const store = secretStoreFromEnv();
  if (!store.writable || !store.put) {
    back(environment, 'error=readonly');
  }

  const ref = credentialRefFor(environment);
  const stored = await store.fetch(ref).catch(() => ({}) as Readonly<Record<string, string>>);
  const nextId = clientId || stored['clientId'] || '';
  const nextSecret = clientSecret || stored['clientSecret'] || '';

  if (nextId === '' || nextSecret === '') {
    back(environment, 'error=missing');
  }

  const changed: string[] = [];
  if (clientId !== '' && clientId !== stored['clientId']) {
    changed.push('clientId');
  }
  if (clientSecret !== '' && clientSecret !== stored['clientSecret']) {
    changed.push('clientSecret');
  }
  if (changed.length > 0) {
    await store.put(ref, { clientId: nextId, clientSecret: nextSecret });
  }
  if (webhookSecret !== '') {
    await store.put(`${ref}/webhook`, { webhookSecret });
    changed.push('webhookSecret');
  }

  await operatorQuery(async (db) => {
    await setProviderConnection(
      db,
      {
        provider: PRIMARY_PROVIDER,
        environment,
        kind: 'openbanking',
        baseUrl,
        authUrl,
        credentialRef: ref,
      },
      operatorId,
    );

    const connection = (await listProviderConnections(db)).find(
      (row) => row.provider === PRIMARY_PROVIDER && row.environment === environment,
    );
    // The address the data source posts to exists from the first save, so there is
    // always something to paste into its dashboard. Saving again never rotates it.
    if (!connection?.callbackSlug || !connection.callbackSecretRef) {
      await setCallback(db, {
        provider: PRIMARY_PROVIDER,
        environment,
        secretRef: `${ref}/webhook`,
        header: connection?.callbackHeader ?? 'x-nx-provider-signature',
        algorithm: connection?.callbackAlgorithm ?? 'sha256',
        rotate: false,
      });
    }

    if (changed.length > 0) {
      await recordOperatorChange(db, {
        operatorId,
        action: 'credentials.saved',
        target: `${PRIMARY_PROVIDER}/${environment}`,
        // Which fields, never their values.
        metadata: { fields: changed },
      });
    }
  });

  back(environment, 'saved=1');
}

export async function testIntegrationAction(formData: FormData): Promise<void> {
  const { id: operatorId } = await requireOperatorPermission('integration');
  const environment = environmentOf(formData);

  const connection = await operatorQuery(async (db) =>
    (await listProviderConnections(db)).find(
      (row) => row.provider === PRIMARY_PROVIDER && row.environment === environment,
    ),
  );
  if (!connection?.authUrl || !connection.credentialRef) {
    back(environment, 'error=unconfigured');
  }

  const material = await secretStoreFromEnv()
    .fetch(connection.credentialRef)
    .catch(() => null);
  const result =
    material?.['clientId'] && material['clientSecret']
      ? await testClientCredentials({
          authUrl: connection.authUrl,
          clientId: material['clientId'],
          clientSecret: material['clientSecret'],
        })
      : { ok: false, detail: 'no stored credential' };

  await operatorQuery(async (db) => {
    await recordConnectionTest(db, { provider: PRIMARY_PROVIDER, environment, ...result });
    await recordOperatorChange(db, {
      operatorId,
      action: 'connection.tested',
      target: `${PRIMARY_PROVIDER}/${environment}`,
      metadata: { ok: result.ok, detail: result.detail },
    });
  });

  back(environment, 'tested=1');
}

export async function rotateCallbackAction(formData: FormData): Promise<void> {
  const { id: operatorId } = await requireOperatorPermission('integration');
  const environment = environmentOf(formData);
  const header = String(formData.get('callback_header') ?? '')
    .trim()
    .toLowerCase();
  const algorithm =
    String(formData.get('callback_algorithm') ?? 'sha256') === 'sha512' ? 'sha512' : 'sha256';

  await operatorQuery(async (db) => {
    await setCallback(db, {
      provider: PRIMARY_PROVIDER,
      environment,
      secretRef: `${credentialRefFor(environment)}/webhook`,
      header: header === '' ? 'x-nx-provider-signature' : header,
      algorithm,
      rotate: formData.get('rotate') === '1',
    });
    await recordOperatorChange(db, {
      operatorId,
      action: formData.get('rotate') === '1' ? 'callback.rotated' : 'callback.updated',
      target: `${PRIMARY_PROVIDER}/${environment}`,
      metadata: { header, algorithm },
    });
  });

  back(environment, 'saved=1');
}
