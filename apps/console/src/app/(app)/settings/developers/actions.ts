'use server';

import { revalidatePath } from 'next/cache';
import { issueApiKey, revokeApiKey } from '@nx-verify/core';
import { query } from '../../../../lib/context';
import type { IssuedKeyState } from '../../../../components/issued-once';

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

/**
 * The secret, returned to the page that asked, and stored nowhere.
 *
 * It used to come back in the address, which put it in the browser's history, in the referrer
 * of the next request and in every access log on the way (SEC-10). It is the result of this
 * action now: it reaches the screen that asked and goes nowhere else.
 */
export async function issueKeyAction(
  _previous: IssuedKeyState,
  formData: FormData,
): Promise<IssuedKeyState> {
  const name = String(formData.get('name') ?? '').trim();
  if (name === '') {
    return { secret: null };
  }

  const issued = await query((tx) => issueApiKey(tx, { name, scopes: DEFAULT_SCOPES }));
  revalidatePath('/settings/developers');
  return { secret: issued.secret };
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  const keyId = String(formData.get('key_id') ?? '');
  if (keyId === '') {
    return;
  }
  await query((tx) => revokeApiKey(tx, keyId));
  revalidatePath('/settings/developers');
}
