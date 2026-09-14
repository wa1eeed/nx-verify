import type { ReactElement, ReactNode } from 'react';
import { sandboxLink } from '@nx-verify/core';
import { Shell } from '../../components/shell';
import { actingUser, query } from '../../lib/context';
import { readFrameFacts } from '../../lib/frame-facts';

/**
 * The frame, with the facts it needs on every screen.
 *
 * Which workspace this is decides whether every screen carries the sandbox note, the unread
 * count sits on the customers place, and the balance sits at the foot of the sidebar. They
 * are read here rather than inside the frame, so the frame stays renderable without a
 * database.
 *
 * A move inside the console does not render this again, so the sidebar reads its count and
 * balance again by itself once the move settles (unit C4). Every screen also checks the
 * session for itself, through query, rather than trusting this layout to have done it.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const user = await actingUser();
  const { workspace, facts } = await query(async (tx) => ({
    // Sequential: one connection, one transaction, one query at a time.
    workspace: await sandboxLink(tx),
    facts: await readFrameFacts(tx, user.userId),
  }));

  return (
    <Shell isSandbox={workspace.isSandbox} unread={facts.unread} balance={facts.balance}>
      {children}
    </Shell>
  );
}
