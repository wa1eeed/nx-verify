'use server';

import { revalidatePath } from 'next/cache';
import { assignCase } from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';

/**
 * Taking the unassigned cases that are on screen (ADR-146).
 *
 * The page sends the ids it is showing, so the button claims what the reader can see rather
 * than whatever the queue holds. A button that quietly takes five hundred cases is not an
 * assignment, it is an accident, and the person who pressed it now owns a backlog they never
 * looked at.
 *
 * A case that cannot be assigned, because somebody else took it a second ago or it has moved
 * on, is skipped rather than failing the whole press. Losing a race is not an error worth
 * showing anybody.
 *
 * Each case gets its own transaction, so a refusal is one case skipped rather than the rest
 * of the page lost with it. Inside one transaction a failed statement poisons every statement
 * after it, and «assign what you can» would become «assign until the first surprise».
 */
export async function claimCasesAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  const caseIds = formData
    .getAll('case_id')
    .map((value) => String(value))
    .filter((id) => id !== '');
  if (caseIds.length === 0) {
    return;
  }

  for (const caseId of caseIds) {
    await query((tx) => assignCase(tx, caseId, user.userId)).catch(() => undefined);
  }

  revalidatePath('/customers/reviews');
}
