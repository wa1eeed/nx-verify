import { readFrameFacts } from '../../../lib/frame-facts';
import { actingUser, query } from '../../../lib/context';

/**
 * The sidebar's facts for the signed in person, read again after a move inside the console
 * (unit C4). Only what the sidebar already shows: a count and a balance, for this session's
 * own workspace, never stored by the browser. Without a session it answers as every screen
 * does, with the sign in page.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const user = await actingUser();
  const facts = await query((tx) => readFrameFacts(tx, user.userId));
  return Response.json(facts, { headers: { 'cache-control': 'no-store' } });
}
