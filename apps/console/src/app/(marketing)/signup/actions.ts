'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  NxError,
  completeSignup,
  createSession,
  masterKeySourceFromEnv,
  DerivedTenantKeyProvider,
  startSignup,
} from '@nx-verify/core';
import { withTenant, withoutTenant } from '@nx-verify/db';
import { getPool } from '../../../lib/context';
import { sessionCookie } from '../../../lib/auth';
import { sendNow } from '../../../lib/mail';

/**
 * A company signing itself up (ADR-154).
 *
 * The workspace is not created until the address is proved, so what this writes first is an
 * intent: the answers sealed, and a code on its way. Somebody who abandons the form leaves a
 * row that expires, not a tenant.
 *
 * It fails closed on mail, like the sign in code does: if the message cannot be sent there is
 * nothing to type and no way forward, and pretending otherwise would make an account nobody
 * can prove they own.
 */

const INTENT_COOKIE = 'nx_signup';
const INTENT_MINUTES = 30;

function keys(): DerivedTenantKeyProvider {
  return new DerivedTenantKeyProvider(masterKeySourceFromEnv());
}

async function callerIp(): Promise<string | null> {
  const list = await headers();
  const forwarded = list.get('x-forwarded-for');
  return forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : null;
}

export async function startSignupAction(formData: FormData): Promise<void> {
  const answers = {
    legalName: String(formData.get('legal_name') ?? ''),
    activity: String(formData.get('activity') ?? ''),
    unifiedNumber: String(formData.get('unified_number') ?? ''),
    contactName: String(formData.get('contact_name') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  };

  const ip = await callerIp();
  let started;
  try {
    started = await withoutTenant(getPool(), (tx) => startSignup(tx, keys(), { ...answers, ip }));
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    const code = (error as { code?: string }).code;
    if (code !== 'NX-4029' && code !== 'NX-4002') {
      // Anything that is not the form's own fault is ours, and saying «check your fields»
      // about our fault sends somebody to re-read a form that was already correct.
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'signup could not start',
          code: code ?? 'unknown',
          detail: (error as Error).message,
        }),
      );
      redirect('/signup?refused=failed');
    }
    redirect(`/signup?refused=${code === 'NX-4029' ? 'too-soon' : 'invalid'}`);
  }

  const sent = await sendNow({
    to: started.email,
    toName: answers.contactName,
    subject: 'رمز إنشاء حسابك في NX Trust',
    body: [
      `رمز إنشاء الحساب: ${started.code}`,
      '',
      'ينتهي بعد نصف ساعة، ويُستعمل مرة واحدة.',
      '',
      'إن لم تطلب إنشاء حساب فلا تفعل شيئاً: لا يُنشأ حساب بلا هذا الرمز.',
    ].join('\n'),
  });

  if (!sent) {
    // Nothing was created, and the intent expires by itself.
    redirect('/signup?refused=mail');
  }

  (await cookies()).set(INTENT_COOKIE, started.intentId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/signup',
    expires: new Date(Date.now() + INTENT_MINUTES * 60_000),
  });

  redirect('/signup/verify');
}

/**
 * Spends the code, makes the workspace, and signs them straight in.
 *
 * Signing in here rather than sending them to the login form is deliberate: they have just
 * proved the address and typed the password, and asking for both again teaches nothing and
 * loses people.
 */
export async function verifySignupAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  const intentId = jar.get(INTENT_COOKIE)?.value ?? '';
  const code = String(formData.get('code') ?? '').trim();
  if (intentId === '' || code === '') {
    redirect('/signup/verify?refused=code');
  }

  let created;
  try {
    created = await withoutTenant(getPool(), (tx) =>
      completeSignup(tx, (tenantId, handler) => withTenant(getPool(), tenantId, handler), keys(), {
        intentId,
        code,
      }),
    );
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    redirect(`/signup/verify?refused=${error instanceof NxError ? 'code' : 'failed'}`);
  }

  const signed = await withTenant(getPool(), created.tenantId, (tx) =>
    createSession(tx, { userId: created.userId, ip: null }),
  );
  const cookie = sessionCookie(signed);
  jar.set(cookie.name, cookie.value, cookie.options);
  jar.delete(INTENT_COOKIE);

  redirect('/welcome');
}

/** A redirect inside a try is a thrown value, not a failure: it has to travel. */
function isRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
