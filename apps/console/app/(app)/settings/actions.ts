'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import {
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

/**
 * Adding someone, moving them, and taking them out.
 *
 * Every action here checks the caller may administer before it does anything. The screen
 * already hides what a non administrator cannot do, but a hidden form is not a closed
 * one: the check that matters is the one on the way in.
 */

export async function createUserAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertRole(actor.role, canAdminister);

  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const displayName = String(formData.get('display_name') ?? '').trim();
  const role = String(formData.get('role') ?? 'ANALYST') as UserRole;
  if (email === '' || displayName === '') {
    return;
  }

  // Temporary by construction, exactly as provisioning does it: the person is made to
  // change it on first sign in, so whoever created the account never knows the password
  // it ends up with.
  const password = `nx-${randomUUID()}`;

  await query(async (tx) => {
    const userId = await createUser(tx, { email, displayName, role });
    await setPassword(tx, { userId, password, mustChange: true });
  });

  revalidatePath('/settings');
  const { redirect } = await import('next/navigation');
  // Shown once, on the screen that asked for it. A refresh loses it, and the way back is
  // to issue a new one rather than to read the old one again.
  redirect(
    `/settings?created=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
  );
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
