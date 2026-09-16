'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { beginSignIn, pendingCookie, sessionCookie, startSso } from '../../../lib/auth';
import { sendNow } from '../../../lib/mail';

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

/**
 * The password step.
 *
 * Where a deployment asks for a second one (ADR-143), no session is minted here at all: the
 * code is mailed, a pending handle goes into a cookie, and the session is minted only when
 * the code is spent. A session created and then discarded is a session that existed.
 *
 * **It fails closed.** If the message cannot be sent the sign in stops, because a second step
 * that disappears when a mail service is down is not a second step. The way out is the panel,
 * whose own second step is an authenticator and does not depend on mail.
 */
export async function passwordSignInAction(formData: FormData): Promise<void> {
  let destination = '/dashboard';

  try {
    const outcome = await beginSignIn({
      slug: String(formData.get('slug') ?? ''),
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      ip: await callerIp(),
    });

    if (outcome.step === 'signed-in') {
      const cookie = sessionCookie(outcome.signed);
      (await cookies()).set(cookie.name, cookie.value, cookie.options);
    } else {
      const sent = await sendNow({
        to: outcome.to,
        toName: outcome.toName,
        subject: 'رمز الدخول إلى NX Trust',
        body: `رمز دخولك هو ${outcome.code}\n\nينتهي بعد عشر دقائق، ويُستعمل مرة واحدة.\n\nإن لم تكن أنت من طلبه فلا تفعل شيئاً، ولا أحد يدخل بحسابك بهذا الرمز وحده.`,
      });
      if (!sent) {
        // Nothing is set, so nobody is half signed in, and the code in the database expires
        // by itself.
        redirect('/login?error=mail');
      }
      const cookie = pendingCookie(outcome.pending);
      (await cookies()).set(cookie.name, cookie.value, cookie.options);
      destination = '/login/code';
    }
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    destination = '/login?error=1';
  }

  redirect(destination);
}

/** A redirect inside a try is a thrown value, not a failure: it has to travel. */
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
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
