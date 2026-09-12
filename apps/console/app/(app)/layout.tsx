import type { ReactElement, ReactNode } from 'react';
import { inboxSeenAt, listInbox, sandboxLink } from '@nx-verify/core';
import { Shell } from '../../components/shell';
import { actingUser, query } from '../../lib/context';

/**
 * The shell, with the one fact it needs.
 *
 * Which workspace this is decides whether every screen carries the sandbox band, and that
 * is read here rather than inside the shell so the shell stays renderable without a
 * database.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const user = await actingUser();
  const { workspace, unread } = await query(async (tx) => ({
    workspace: await sandboxLink(tx),
    // Counted in the shell so the badge is right on every screen, not only on the one
    // that happens to fetch it.
    unread: (await listInbox(tx, { seenAt: await inboxSeenAt(tx, user.userId) })).unread,
  }));

  return (
    <Shell isSandbox={workspace.isSandbox} unread={unread}>
      {children}
    </Shell>
  );
}
