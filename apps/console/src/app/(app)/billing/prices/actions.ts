'use server';

import { revalidatePath } from 'next/cache';
import { assertRole, audit, canAdminister, setPreferences } from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';

/**
 * Whether the verification screens show what each check costs (README, screen 02).
 *
 * A subscriber may not want the people who run checks to see prices. Hiding them changes
 * nothing about what is charged, and only an administrator may choose it: the check below is
 * the one that matters, not the hidden form.
 */
export async function setShowPricesAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertRole(actor.role, canAdminister);
  const showPrices = formData.get('show_prices') === 'on';

  await query(async (tx) => {
    await setPreferences(tx, { showPrices });
    await audit(tx, {
      actorType: 'USER',
      actorId: actor.userId === '' ? 'development' : actor.userId,
      action: 'preferences.updated',
      metadata: { show_prices: showPrices },
    });
  });
  revalidatePath('/billing/prices');
  revalidatePath('/verifications/new');
}
