'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertCan, audit, endRelation } from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';

/**
 * Ending a role somebody no longer holds (ADR-168).
 *
 * `ended_at` was written by nothing at all, so every relation the platform ever recorded was
 * permanent: a manager who resigned stayed a manager on the customer file forever and kept
 * raising `manager_many_companies` and the SHARED_MANAGER intersection.
 *
 * A deliberate act, not an inference. Closing every relation a verification did not re-name was
 * tried and reverted: `MANAGER_AUTHORITY` runs once per manager, so each of those runs would
 * have ended all the others. A resignation is a fact this platform learns from its customer.
 *
 * The row stays and gains a date, so «who was the authorised manager in March» keeps its
 * answer. That is rule 1 in the currency of relations.
 */
export async function endRoleAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  // Ending a role changes what a customer file says and what the risk signals count, so it is
  // a decision, not a view.
  assertCan(actor.capabilities, 'review.decide');

  const relationId = String(formData.get('relation_id') ?? '');
  const partyId = String(formData.get('party_id') ?? '');
  if (relationId === '') {
    return;
  }

  await query(async (tx) => {
    await endRelation(tx, relationId);
    await audit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      action: 'relation.ended',
      target: relationId,
    });
  });

  revalidatePath('/customers/parties');
  redirect(
    partyId === ''
      ? '/customers/parties?ended=1'
      : `/customers/parties?party=${encodeURIComponent(partyId)}&ended=1`,
  );
}
