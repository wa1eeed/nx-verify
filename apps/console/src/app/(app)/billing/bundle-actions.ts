'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertCan, requestBundle } from '@nx-verify/core';
import { actingUser, query } from '../../../lib/context';

/**
 * Asking to buy a credit bundle: a transfer reference for its price, which grants the
 * operations when the transfer arrives. Like asking for credit, anybody in the workspace may.
 */
export async function requestBundleAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'wallet.topup');
  const user = await actingUser();
  const bundleCode = String(formData.get('bundle_code') ?? '');
  const created = await query((tx) => requestBundle(tx, { bundleCode, requestedBy: user.userId }));
  revalidatePath('/billing/invoices');
  // The reference is the number the customer writes on the transfer, not a secret.
  redirect(`/billing/invoices?topup=${encodeURIComponent(created.reference)}`);
}
