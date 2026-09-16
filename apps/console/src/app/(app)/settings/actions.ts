'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import {
  NxError,
  assertRole,
  canAdminister,
  createUser,
  disableUser,
  enableUser,
  setPassword,
  setUserRole,
  type UserRole,
} from '@nx-verify/core';
import { actingUser, query } from '../../../lib/context';
import type { IssuedPasswordState } from '../../../components/issued-once';

/**
 * Adding someone, moving them, and taking them out.
 *
 * Every action here checks the caller may administer before it does anything. The screen
 * already hides what a non administrator cannot do, but a hidden form is not a closed
 * one: the check that matters is the one on the way in.
 */

/**
 * A new account, and the one time its password exists in plain text.
 *
 * It used to come back in the address, which put it in the browser's history, in the referrer
 * of the next request and in every access log on the way (SEC-10). It is the result of this
 * action now: it reaches the screen that asked and goes nowhere else. A refresh loses it, and
 * the way back is a new password rather than a second look at the old one.
 */
export async function createUserAction(
  _previous: IssuedPasswordState,
  formData: FormData,
): Promise<IssuedPasswordState> {
  const actor = await actingUser();
  assertRole(actor.role, canAdminister);

  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const displayName = String(formData.get('display_name') ?? '').trim();
  const role = String(formData.get('role') ?? 'ANALYST') as UserRole;
  if (email === '' || displayName === '') {
    return { account: null, refusalAr: 'لم يُضَف: البريد والاسم مطلوبان.' };
  }

  // Temporary by construction, exactly as provisioning does it: the person is made to
  // change it on first sign in, so whoever created the account never knows the password
  // it ends up with.
  const password = `nx-${randomUUID()}`;

  try {
    await query(async (tx) => {
      const userId = await createUser(tx, { email, displayName, role });
      await setPassword(tx, { userId, password, mustChange: true });
    });
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    return {
      account: null,
      refusalAr:
        error.code === 'NX-4091'
          ? 'لم يُضَف: في مساحة العمل شخص بهذا البريد.'
          : 'لم يُضَف: تحقق من البريد والاسم والدور.',
    };
  }

  revalidatePath('/settings');
  return { account: { email, password }, refusalAr: null };
}

export async function setRoleAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertRole(actor.role, canAdminister);

  const userId = String(formData.get('user_id') ?? '');
  const role = String(formData.get('role') ?? '');
  if (userId === '' || role === '') {
    return;
  }

  await query((tx) => setUserRole(tx, userId, role as UserRole, actor.userId));
  revalidatePath('/settings');
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertRole(actor.role, canAdminister);

  const userId = String(formData.get('user_id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (userId === '') {
    return;
  }

  await query((tx) =>
    status === 'disabled'
      ? disableUser(tx, userId, actor.userId)
      : enableUser(tx, userId, actor.userId),
  );
  revalidatePath('/settings');
}
