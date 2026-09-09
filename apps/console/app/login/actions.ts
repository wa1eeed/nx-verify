'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionCookie, signInWithPassword, startSso } from '../../lib/auth';

/**
 * The two doors, as server actions.
 *
 * Every failure lands back on the same screen with the same message and no detail in the
 * address bar, because the difference between "no such workspace" and "wrong password" is
 * exactly what a login form must not tell anyone.
 */

async function callerIp(): Promise<string | null> {
  const list = await headers();
  const forwarded = list.get('x-forwarded-for');
  return forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : null;
}

export async function passwordSignInAction(formData: FormData): Promise<void> {
  let destination = '/dashboard';

  try {
    const signed = await signInWithPassword({
      slug: String(formData.get('slug') ?? ''),
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      ip: await callerIp(),
    });

    const cookie = sessionCookie(signed);
    (await cookies()).set(cookie.name, cookie.value, cookie.options);
  } catch {
    destination = '/login?error=1';
  }

  redirect(destination);
}

export async function ssoSignInAction(formData: FormData): Promise<void> {
  let destination = '/login?error=1';

  try {
    const redirectToProvider = await startSso(String(formData.get('email') ?? ''));
    destination = redirectToProvider.authorizationUrl;
  } catch {
    // Same message as a wrong password: a company that uses a directory here is not
    // something a stranger gets to confirm.
  }

  redirect(destination);
}
