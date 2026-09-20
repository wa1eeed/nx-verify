'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NxError, assertCan, requestBundle, requestTopUp } from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';
import type { CheckoutRefusal } from './refusals';

/**
 * Places the order the checkout screen described (ADR-158).
 *
 * Bank transfer is the only method that exists, so there is nothing to branch on yet: what
 * this records is a request and a reference, and the money arrives out of band. When a payment
 * gateway is added it becomes the second branch here, and the screen already has its place.
 *
 * Nothing is charged and no balance moves. A request is a statement of intent until somebody
 * in finance confirms the transfer arrived.
 *
 * The domain call is caught, which it was not (ADR-187). Two of its refusals are things a
 * subscriber can walk into without doing anything wrong: an amount outside the range, and a
 * bundle the panel withdrew while this screen was open. Uncaught, each one replaced the whole
 * portal with the framework's default error page at the exact moment somebody pressed the buy
 * button. A refusal now returns to the screen they pressed it on, describing the same
 * purchase, with a sentence about what happened to the order.
 */
export async function placeOrderAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'wallet.topup');

  const bundleCode = String(formData.get('bundle_code') ?? '').trim();
  const amountHalalas = Number(String(formData.get('amount_halalas') ?? ''));

  let created;
  try {
    created = await query((tx) =>
      bundleCode === ''
        ? requestTopUp(tx, { amountHalalas, requestedBy: actor.userId })
        : requestBundle(tx, { bundleCode, requestedBy: actor.userId }),
    );
  } catch (error) {
    // A redirect is thrown, not returned: a session that ended mid order has to reach the
    // sign in screen rather than be reported as a failed purchase.
    if (isRedirect(error)) {
      throw error;
    }
    redirect(`${describing(bundleCode, amountHalalas)}&outcome=${refusalOf(error)}`);
  }

  revalidatePath('/billing/invoices');
  revalidatePath('/billing');
  // The reference is the number the subscriber writes on the transfer, not a secret.
  redirect(
    `/billing/checkout?ref=${encodeURIComponent(created.reference)}&total=${created.totalWithVatHalalas}`,
  );
}

/**
 * The same screen, still describing the same purchase.
 *
 * Sending somebody back to an empty checkout after a refusal makes them find the bundle or
 * type the amount again, which is a second chance to give up.
 */
function describing(bundleCode: string, amountHalalas: number): string {
  if (bundleCode !== '') {
    return `/billing/checkout?bundle=${encodeURIComponent(bundleCode)}`;
  }
  // An amount that was never a number describes nothing, and the screen says so by itself.
  return Number.isFinite(amountHalalas)
    ? `/billing/checkout?amount=${encodeURIComponent(String(amountHalalas / 100))}`
    : '/billing/checkout?';
}

/** Our codes, not a message: what the screen tells the buyer is written on the screen. */
function refusalOf(error: unknown): CheckoutRefusal {
  const code = error instanceof NxError ? error.code : null;
  if (code === 'NX-4001') {
    return 'amount';
  }
  return code === 'NX-4041' ? 'sold-out' : 'failed';
}

function isRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
