'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import {
  NxError,
  assertCan,
  clearCapabilityOverrides,
  createUser,
  disableUser,
  enableUser,
  getUser,
  isCapability,
  presetFor,
  setPassword,
  setUserCapability,
  setUserRole,
  type UserRole,
} from '@nx-verify/core';
import { actingUser, query } from '../../../lib/context';
import type { IssuedPasswordState } from '../../../components/issued-once';

/**
 * Adding someone, moving them, and taking them out.
 *
 * Every action here checks the caller holds `users.manage` before it does anything. The
 * screen already hides what somebody without it cannot do, but a hidden form is not a closed
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
  assertCan(actor.capabilities, 'users.manage');

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
  assertCan(actor.capabilities, 'users.manage');

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
  assertCan(actor.capabilities, 'users.manage');

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

/**
 * One permission, for one person.
 *
 * The screen sends the state it wants rather than a toggle, so two administrators pressing
 * the same button at once arrive at the same place instead of undoing each other. When the
 * wanted state already matches what the role gives, the exception is deleted rather than
 * stored: an exception that says «the same as the default» is the kind of row that makes a
 * permissions screen stop being readable a year later.
 */
export async function setCapabilityAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'users.manage');

  const userId = String(formData.get('user_id') ?? '');
  const capability = String(formData.get('capability') ?? '');
  const granted = String(formData.get('granted') ?? '') === 'true';
  if (userId === '' || !isCapability(capability)) {
    return;
  }

  await query(async (tx) => {
    const user = await getUser(tx, userId);
    if (user === null) {
      return;
    }
    const matchesRole = presetFor(user.role).has(capability) === granted;
    await setUserCapability(tx, {
      userId,
      capability,
      granted: matchesRole ? null : granted,
      actorId: actor.userId,
    });
  });

  revalidatePath('/settings');
}

/** Puts somebody back on exactly what their role carries. */
export async function resetCapabilitiesAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'users.manage');

  const userId = String(formData.get('user_id') ?? '');
  if (userId === '') {
    return;
  }

  await query((tx) => clearCapabilityOverrides(tx, userId, actor.userId));

  revalidatePath('/settings');
}
