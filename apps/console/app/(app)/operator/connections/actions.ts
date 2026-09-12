'use server';

import { revalidatePath } from 'next/cache';
import { secretStoreFromEnv, setProviderConnection } from '@nx-verify/providers';
import { operatorQuery, requireOperator } from '../../../../lib/operator';

/**
 * Saving a provider's connection, and saving its credential.
 *
 * They are two actions on purpose. The first writes a row: an address, a kind, a
 * reference. The second writes through to the secret store and touches no table of ours,
 * which is rule 10 with no exception: the material never reaches our database, our
 * backups or our logs.
 */

export async function setConnectionAction(formData: FormData): Promise<void> {
  const operatorId = await requireOperator();

  const kind = String(formData.get('kind') ?? 'http') as 'stub' | 'http' | 'openbanking';
  const baseUrl = String(formData.get('base_url') ?? '').trim();
  const authUrl = String(formData.get('auth_url') ?? '').trim();
  const credentialRef = String(formData.get('credential_ref') ?? '').trim();

  await operatorQuery((db) =>
    setProviderConnection(
      db,
      {
        provider: String(formData.get('provider') ?? ''),
        environment: String(formData.get('environment') ?? 'sandbox') as 'sandbox' | 'live',
        kind,
        baseUrl: baseUrl === '' ? null : baseUrl,
        authUrl: authUrl === '' ? null : authUrl,
        credentialRef: credentialRef === '' ? null : credentialRef,
      },
      operatorId,
    ),
  );

  revalidatePath('/operator/connections');
}

export async function setSecretAction(formData: FormData): Promise<void> {
  await requireOperator();

  const provider = String(formData.get('provider') ?? '');
  const environment = String(formData.get('environment') ?? 'sandbox');
  const clientId = String(formData.get('client_id') ?? '').trim();
  const secret = String(formData.get('secret') ?? '');

  if (provider === '' || secret === '') {
    return;
  }

  const store = secretStoreFromEnv();
  if (!store.put) {
    // Refused rather than half done. The screen already says which variable to set.
    throw new Error('this deployment reads secrets from its environment, which a panel cannot write');
  }

  // The material goes to the store and nowhere else. The reference is what our row holds.
  await store.put(`kms://providers/${provider}/${environment}`, {
    ...(clientId === '' ? {} : { clientId, apiKey: clientId }),
    clientSecret: secret,
  });

  revalidatePath('/operator/connections');
}
