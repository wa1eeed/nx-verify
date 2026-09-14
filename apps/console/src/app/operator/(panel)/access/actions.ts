'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  NxError,
  authenticateOperator,
  createOperatorAccount,
  getOperatorAccount,
  setOperatorPassword,
  updateOperatorAccount,
  type OperatorRole,
  type OperatorStatus,
} from '@nx-verify/core';
import {
  currentOperator,
  operatorQuery,
  operatorTransaction,
  requireOperatorPermission,
} from '../../../../lib/operator';

/**
 * Staff, changed by staff (PLAN.md, decision 5).
 *
 * Only an owner adds a member or changes a role or a status, and every change is written to
 * the trail against the person who made it. Anybody signed in may change their own password,
 * after typing the one they have.
 */

function back(params: Record<string, string>): never {
  redirect(`/operator/access?${new URLSearchParams(params).toString()}`);
}

function refusalOf(error: unknown): string {
  if (!(error instanceof NxError)) {
    throw error;
  }
  switch (error.code) {
    case 'NX-4001':
      return 'password';
    case 'NX-4091':
      return /owner/.test(error.message) ? 'last-owner' : 'exists';
    case 'NX-4011':
    case 'NX-4029':
      return 'current';
    default:
      return 'invalid';
  }
}

export async function addStaffAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('staff');
  try {
    await operatorTransaction((db) =>
      createOperatorAccount(db, actor, {
        displayName: String(formData.get('display_name') ?? ''),
        email: String(formData.get('email') ?? ''),
        role: String(formData.get('role') ?? 'READ_ONLY') as OperatorRole,
        password: String(formData.get('password') ?? ''),
      }),
    );
  } catch (error) {
    back({ refused: refusalOf(error) });
  }
  revalidatePath('/operator/access');
  back({ saved: 'staff-added' });
}

export async function updateStaffAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('staff');
  const id = String(formData.get('id') ?? '');
  const password = String(formData.get('password') ?? '');
  try {
    await operatorTransaction(async (db) => {
      await updateOperatorAccount(db, actor, id, {
        role: String(formData.get('role') ?? '') as OperatorRole,
        status: String(formData.get('status') ?? '') as OperatorStatus,
      });
      if (password !== '') {
        await setOperatorPassword(db, actor, id, password);
      }
    });
  } catch (error) {
    back({ refused: refusalOf(error) });
  }
  revalidatePath('/operator/access');
  back({ saved: 'staff-updated' });
}

export async function changeOwnPasswordAction(formData: FormData): Promise<void> {
  const actor = await currentOperator();
  try {
    // Checked outside the transaction that sets the new one, so a wrong current password
    // counts towards the lock even though nothing else is written.
    const account = await operatorQuery((db) => getOperatorAccount(db, actor.id));
    if (account === null) {
      throw new NxError('NX-4031', { detail: 'the token has no password to change' });
    }
    await operatorQuery((db) =>
      authenticateOperator(db, account.email, String(formData.get('current') ?? '')),
    );
    await operatorTransaction((db) =>
      setOperatorPassword(db, actor, actor.id, String(formData.get('next') ?? '')),
    );
  } catch (error) {
    back({ refused: refusalOf(error) });
  }
  back({ saved: 'password' });
}
