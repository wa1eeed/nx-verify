'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PENDING_COOKIE, finishSignIn, readPending, sessionCookie } from '../../../../lib/auth';

/**
 * The second step (ADR-143).
 *
 * The session is minted here and nowhere else when a deployment asks for a code, so a
 * password alone never leaves anything behind that can be used.
 *
 * Every refusal is the same: a wrong code, a spent one, an expired one and a handle that
 * never existed all land on the same sentence. The attempt is counted in the database, and
 * five wrong guesses end that code whatever the clock says.
 */

export async function codeSignInAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  const pending = readPending(jar.get(PENDING_COOKIE)?.value);
  if (pending === null) {
    redirect('/login');
  }

  let destination = '/dashboard';
  try {
    const signed = await finishSignIn(pending, String(formData.get('code') ?? ''));
    const cookie = sessionCookie(signed);
    jar.set(cookie.name, cookie.value, cookie.options);
    jar.delete(PENDING_COOKIE);
  } catch {
    destination = '/login/code?error=1';
  }
  redirect(destination);
}

/** Leaves the half finished sign in. The code expires by itself. */
export async function abandonCodeAction(): Promise<void> {
  (await cookies()).delete(PENDING_COOKIE);
  redirect('/login');
}
