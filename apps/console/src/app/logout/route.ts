import { NextResponse } from 'next/server';
import { revokeCurrentSession } from '../../lib/auth-session';

/**
 * Signing out ends the session in the database, not only in the browser.
 *
 * A cookie deleted from one browser leaves the session usable by anyone who copied the
 * token, which is the case signing out exists for.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  await revokeCurrentSession();
  const response = NextResponse.redirect(new URL('/login', request.url), { status: 303 });
  response.cookies.delete('nx_session');
  return response;
}
