'use server';

import { redirect } from 'next/navigation';
import { withTenant } from '@nx-verify/db';
import { changeOwnPassword } from '@nx-verify/core';
import { getPool, sessionForPasswordChange } from '../../lib/context';

/**
 * The one write a person can make about their own account.
 *
 * The current password is required, and a failure says one thing: whether it was the old
 * password that was wrong or the new one that was too short is not worth telling apart on
 * a screen, and the rule itself is printed above the field.
 */
export async function changePasswordAction(formData: FormData): Promise<void> {
  const session = await sessionForPasswordChange();
  let destination = '/dashboard';

  try {
    await withTenant(getPool(), session.tenantId, (tx) =>
      changeOwnPassword(
        tx,
        session.userId,
        String(formData.get('current') ?? ''),
        String(formData.get('next') ?? ''),
      ),
    );
  } catch {
    destination = '/password?error=1';
  }

  redirect(destination);
}
