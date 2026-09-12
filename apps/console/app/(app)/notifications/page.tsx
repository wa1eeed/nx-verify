import type { ReactElement } from 'react';
import { inboxSeenAt, listInbox, markInboxSeen } from '@nx-verify/core';
import { Inbox } from '../../../components/inbox';
import { actingUser, query } from '../../../lib/context';

export const dynamic = 'force-dynamic';

/**
 * Opening the centre is what marks it read.
 *
 * The timestamp is read before the sweep and written after it, so an item that arrives
 * while the page is rendering is still new next time rather than silently swallowed.
 */
export default async function NotificationsPage(): Promise<ReactElement> {
  const user = await actingUser();

  const { inbox, seenAt } = await query(async (tx) => {
    const previous = await inboxSeenAt(tx, user.userId);
    const result = await listInbox(tx, { seenAt: previous });
    await markInboxSeen(tx, user.userId);
    return { inbox: result, seenAt: previous };
  });

  return <Inbox items={inbox.items} seenAt={seenAt} />;
}
