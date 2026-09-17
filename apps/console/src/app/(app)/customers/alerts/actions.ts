'use server';

import { revalidatePath } from 'next/cache';
import { acknowledgeChange, audit } from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';

/**
 * Closing a detected change (ADR-146).
 *
 * The detection has always been there and nothing could ever close it, so every change a
 * workspace had ever seen stayed open: the alert count climbed for ever, the customer list's
 * alert facet only grew, and the badge in the sidebar became a number nobody read. A signal
 * that cannot be cleared stops being a signal.
 *
 * Acknowledging does not deny the change. The change event itself is never edited, and the
 * `entity_changed` attestations behind it are untouched, as rule 1 requires. What is recorded
 * is a second fact: this person looked at it, on this date.
 */
export async function acknowledgeChangeAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  const changeEventId = String(formData.get('change_event_id') ?? '');
  if (changeEventId === '') {
    return;
  }

  await query(async (tx) => {
    await acknowledgeChange(tx, changeEventId, user.userId);
    await audit(tx, {
      actorType: 'USER',
      actorId: user.userId,
      action: 'change.acknowledged',
      target: changeEventId,
      metadata: {},
    });
  });

  // The list, the file and the sidebar all count what is open.
  revalidatePath('/customers/alerts');
  revalidatePath('/customers');
  revalidatePath('/dashboard');
}
