import { NextResponse } from 'next/server';
import { OPERATOR_COOKIE } from '../../../lib/operator';

/** Never cached. */
export const dynamic = 'force-dynamic';

/**
 * Signing out of the panel.
 *
 * The session value is derived from the token and holds no row anywhere, so removing the
 * cookie is the whole of it. Signing out everybody at once is rotating the token.
 */
export function POST(request: Request): Response {
  const response = NextResponse.redirect(new URL('/operator/login', request.url), { status: 303 });
  response.cookies.set(OPERATOR_COOKIE, '', { path: '/operator', maxAge: 0 });
  return response;
}
