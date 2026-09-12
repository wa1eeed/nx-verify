'use server';

import { revalidatePath } from 'next/cache';
import { issueApiKey, revokeApiKey } from '@nx-verify/core';
import { query } from '../../../../lib/context';

/**
 * Issuing and revoking.
 *
 * A new key gets the scopes the workspace already uses rather than a form full of
 * checkboxes, because the failure mode of that form is a key with every scope issued by
 * somebody who wanted one endpoint. Narrowing a key further is an operator conversation,
 * which is the right amount of friction for widening access.
 */

const DEFAULT_SCOPES = [
  'verifications:write',
  'verifications:read',
  'onboarding:write',
  'onboarding:read',
  'products:read',
  'entities:read',
  'wallet:read',
];

/** The secret, returned to the page that asked, and stored nowhere. */
export async function issueKeyAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  if (name === '') {
    return;
  }

  const issued = await query((tx) => issueApiKey(tx, { name, scopes: DEFAULT_SCOPES }));

  // Carried back in the address for one render and never written down. A cookie would
  // outlive the page, and the database already refuses to hold it.
  const { redirect } = await import('next/navigation');
  redirect(`/settings/api-keys?issued=${encodeURIComponent(issued.secret)}`);
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  const keyId = String(formData.get('key_id') ?? '');
  if (keyId === '') {
    return;
  }
  await query((tx) => revokeApiKey(tx, keyId));
  revalidatePath('/settings/api-keys');
}
