import { subscribersBoard } from '@nx-verify/core';
import { subscribersCsv } from '../../../../../components/admin-subscribers/model';
import { currentOperator, operatorQuery } from '../../../../../lib/operator';

/**
 * «تصدير» (handoff screen 06): the subscribers table as a spreadsheet.
 *
 * The same rows and words as the screen, and nothing a subscriber verified. A route is not
 * inside the panel's layout, so it checks the sign in itself and answers a stranger with a
 * refusal rather than a file.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await currentOperator();
  } catch {
    return new Response('operator sign in required', { status: 401 });
  }
  const board = await operatorQuery((db) => subscribersBoard(db));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(subscribersCsv(board.rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="nx-trust-subscribers-${day}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
