import type { ReactElement, ReactNode } from 'react';
import {
  bundleBalance,
  getCommitment,
  getWallet,
  inboxSeenAt,
  listInbox,
  sandboxLink,
} from '@nx-verify/core';
import { Shell } from '../../components/shell';
import { balanceOf } from '../../lib/balance';
import { actingUser, query } from '../../lib/context';

/**
 * The frame, with the facts it needs on every screen.
 *
 * Which workspace this is decides whether every screen carries the sandbox note, the unread
 * count sits on the customers place, and the balance sits at the foot of the sidebar. They
 * are read here rather than inside the frame, so the frame stays renderable without a
 * database.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const user = await actingUser();
  const { workspace, unread, balance } = await query(async (tx) => {
    // Sequential: one connection, one transaction, one query at a time.
    const workspace = await sandboxLink(tx);
    const unread = (await listInbox(tx, { seenAt: await inboxSeenAt(tx, user.userId) })).unread;
    const commitment = await getCommitment(tx);
    const bundles = await bundleBalance(tx);
    const wallet = await getWallet(tx);
    return { workspace, unread, balance: balanceOf(commitment, bundles, wallet.available) };
  });

  return (
    <Shell isSandbox={workspace.isSandbox} unread={unread} balance={balance}>
      {children}
    </Shell>
  );
}
