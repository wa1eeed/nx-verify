'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertCan, requestBundle, requestTopUp } from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';

/**
 * Places the order the checkout screen described (ADR-158).
 *
 * Bank transfer is the only method that exists, so there is nothing to branch on yet: what
 * this records is a request and a reference, and the money arrives out of band. When a payment
 * gateway is added it becomes the second branch here, and the screen already has its place.
 *
 * Nothing is charged and no balance moves. A request is a statement of intent until somebody
 * in finance confirms the transfer arrived.
 */
export async function placeOrderAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'wallet.topup');

  const bundleCode = String(formData.get('bundle_code') ?? '').trim();
  const amountHalalas = Number(String(formData.get('amount_halalas') ?? ''));

  const created = await query((tx) =>
    bundleCode === ''
      ? requestTopUp(tx, { amountHalalas, requestedBy: actor.userId })
      : requestBundle(tx, { bundleCode, requestedBy: actor.userId }),
  );

  revalidatePath('/billing/invoices');
  revalidatePath('/billing');
  // The reference is the number the subscriber writes on the transfer, not a secret.
  redirect(
    `/billing/checkout?ref=${encodeURIComponent(created.reference)}&total=${created.totalWithVatHalalas}`,
  );
}
