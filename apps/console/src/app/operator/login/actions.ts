'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  OPERATOR_COOKIE,
  OPERATOR_SESSION_HOURS,
  operatorSessionValue,
  operatorTokenMatches,
} from '../../../lib/operator';

/**
 * Signing in to the administration panel.
 *
 * The token is checked once, here, and what the browser keeps is a derived value that
 * expires. The cookie is scoped to the panel's own path, so it is never sent with a
 * subscriber's requests, and it is strict about where it is sent from.
 *
 * A failure waits a moment before answering. The token is long enough that guessing it
 * is not a plan anyway, and the pause costs a person nothing.
 */
export async function operatorSignInAction(formData: FormData): Promise<void> {
  const presented = String(formData.get('token') ?? '');
  const token = process.env['NX_OPERATOR_TOKEN'];

  if (!token || !operatorTokenMatches(presented)) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    redirect('/operator/login?error=1');
  }

  const expiresAt = Date.now() + OPERATOR_SESSION_HOURS * 3_600_000;
  (await cookies()).set(OPERATOR_COOKIE, operatorSessionValue(token, expiresAt), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/operator',
    expires: new Date(expiresAt),
  });

  redirect('/operator');
}
