'use server';

import { revalidatePath } from 'next/cache';
import { requestTopUp, riyalsToHalalas } from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';

/**
 * Asking for credit.
 *
 * Anybody in the workspace may ask. Nothing moves until we confirm the transfer arrived,
 * so there is nothing here worth restricting to an administrator, and a balance that runs
 * out because only one person could ask helps nobody.
 */
export async function requestTopUpAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  const riyals = Number(formData.get('amount') ?? 0);
  if (!Number.isFinite(riyals) || riyals <= 0) {
    return;
  }

  const created = await query((tx) =>
    requestTopUp(tx, {
      amountHalalas: riyalsToHalalas(riyals),
      requestedBy: user.userId,
    }),
  );

  revalidatePath('/billing/statement');
  const { redirect } = await import('next/navigation');
  // The reference goes in the address so the confirmation survives the redirect, and it
  // is not a secret: it is the number the customer writes on a bank transfer.
  redirect(`/billing/statement?topup=${encodeURIComponent(created.reference)}`);
}
