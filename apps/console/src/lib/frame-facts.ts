import { bundleBalance, getCommitment, getWallet, inboxSeenAt, listInbox } from '@nx-verify/core';
import type { TenantTransaction } from '@nx-verify/db';
import type { FrameFacts } from '../components/frame-facts';
import { balanceOf } from './balance';

/**
 * The facts the sidebar shows on every screen: the alerts that arrived since this person last
 * looked, and what is left to spend.
 *
 * Read by the layout for the first page, and again by the sidebar itself after a move or a
 * form action (unit C4): a move inside the console no longer renders the layout, so a count
 * read only there would stay as it was when the session's first page loaded.
 */
export async function readFrameFacts(tx: TenantTransaction, userId: string): Promise<FrameFacts> {
  // Sequential: one connection, one transaction, one query at a time.
  const unread = (await listInbox(tx, { seenAt: await inboxSeenAt(tx, userId) })).unread;
  const commitment = await getCommitment(tx);
  const bundles = await bundleBalance(tx);
  const wallet = await getWallet(tx);
  return { unread, balance: balanceOf(commitment, bundles, wallet.available) };
}
