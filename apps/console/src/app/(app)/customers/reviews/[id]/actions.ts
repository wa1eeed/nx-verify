'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertCan, approveCase, assignCase, decideCase, returnCase, type CaseOutcome } from '@nx-verify/core';
import { actingUser, query } from '../../../../../lib/context';

/**
 * Working a review case (ADR-146).
 *
 * Everything here already existed in the domain and over the API, and none of it could be
 * reached from the console: the queue listed cases and the screen a reviewer was sent to had
 * one button that did nothing. A queue nobody can work is a list of complaints.
 *
 * Every refusal comes back as a word on the same screen. The four eyes rule is the one that
 * refuses most often and it is refused in the domain, not here: `approveCase` reads who
 * decided, and the trigger from migration 0018 refuses underneath that. A screen that hid
 * the button would be a third place for the same rule to be written down and drift from.
 */

const HERE = (caseId: string) => `/customers/reviews/${caseId}`;

function back(caseId: string, outcome: string): never {
  redirect(`${HERE(caseId)}?outcome=${outcome}`);
}

const isRedirect = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'digest' in error &&
  typeof (error as { digest: unknown }).digest === 'string' &&
  (error as { digest: string }).digest.startsWith('NEXT_REDIRECT');

/** Turns a refusal from the domain into the word the screen shows. */
function refusal(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code === 'NX-4031') {
    return 'role';
  }
  if (code === 'NX-4002') {
    return 'state';
  }
  if (code === 'NX-4001') {
    return 'note';
  }
  return 'failed';
}

export async function assignCaseAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'review.decide');
  const user = await actingUser();
  const caseId = String(formData.get('case_id') ?? '');
  if (caseId === '') {
    return;
  }

  try {
    await query((tx) => assignCase(tx, caseId, user.userId));
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back(caseId, refusal(error));
  }
  revalidatePath(HERE(caseId));
  revalidatePath('/customers/reviews');
  back(caseId, 'assigned');
}

export async function decideCaseAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'review.decide');
  const user = await actingUser();
  const caseId = String(formData.get('case_id') ?? '');
  const outcome = String(formData.get('outcome') ?? '') as CaseOutcome;
  const note = String(formData.get('note') ?? '').trim();
  if (caseId === '') {
    return;
  }
  // Checked here too, so an empty box is a message on the screen rather than a thrown error
  // from the domain. The domain refuses it as well, which is what makes it a rule.
  if (note === '') {
    back(caseId, 'note');
  }

  try {
    await query((tx) => decideCase(tx, { caseId, outcome, decidedBy: user.userId, note }));
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back(caseId, refusal(error));
  }
  revalidatePath(HERE(caseId));
  revalidatePath('/customers/reviews');
  back(caseId, 'decided');
}

export async function approveCaseAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'review.approve');
  const user = await actingUser();
  const caseId = String(formData.get('case_id') ?? '');
  if (caseId === '') {
    return;
  }

  try {
    await query((tx) => approveCase(tx, caseId, user.userId));
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    // The four eyes rule lands here: whoever decided cannot be whoever approves.
    back(caseId, refusal(error) === 'state' ? 'four-eyes' : refusal(error));
  }
  revalidatePath(HERE(caseId));
  revalidatePath('/customers/reviews');
  back(caseId, 'approved');
}

export async function returnCaseAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'review.decide');
  const user = await actingUser();
  const caseId = String(formData.get('case_id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (caseId === '') {
    return;
  }
  if (reason === '') {
    back(caseId, 'reason');
  }

  try {
    await query((tx) => returnCase(tx, caseId, user.userId, reason));
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back(caseId, refusal(error));
  }
  revalidatePath(HERE(caseId));
  revalidatePath('/customers/reviews');
  back(caseId, 'returned');
}
