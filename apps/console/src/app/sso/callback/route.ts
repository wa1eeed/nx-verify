import { NextResponse } from 'next/server';
import { finishSso, sessionCookie } from '../../../lib/auth';

/**
 * Where the identity provider sends the person back.
 *
 * It reads two values from the address and trusts neither: the state has to match a login
 * this console started and has not already finished, and the code is only worth anything
 * to the provider. Everything else about the person comes from a signed identity token,
 * checked in the domain layer.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');

  if (!state || !code) {
    return NextResponse.redirect(new URL('/login?error=1', url));
  }

  try {
    const signed = await finishSso({
      state,
      code,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    });

    const response = NextResponse.redirect(new URL('/dashboard', url));
    const cookie = sessionCookie(signed);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch {
    // The provider's own error, an expired login, a replayed state: one destination.
    return NextResponse.redirect(new URL('/login?error=1', url));
  }
}
