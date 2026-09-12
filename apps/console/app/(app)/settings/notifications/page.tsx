import type { ReactElement } from 'react';
import { listChannels } from '@nx-verify/core';
import { NotificationSettings, type ChannelView } from '../../../../components/notification-settings';
import { query } from '../../../../lib/context';

/** Never prerendered: one subscriber's configuration, read at request time. */
export const dynamic = 'force-dynamic';

export default async function NotificationsPage(): Promise<ReactElement> {
  const channels = await query(async (tx) => {
    const list = await listChannels(tx);
    const { rows } = await tx.query<{
      id: string;
      channel_id: string;
      event_type: string;
      min_severity: string;
    }>(
      `SELECT id, channel_id, event_type, min_severity
       FROM notification_rules
       WHERE tenant_id = $1 AND status = 'active'
       ORDER BY event_type`,
      [tx.tenantId],
    );

    return list.map((channel): ChannelView => ({
      id: channel.id,
      address: channel.address,
      displayName: channel.displayName,
      verified: channel.verified,
      status: channel.status,
      events: rows
        .filter((rule) => rule.channel_id === channel.id)
        .map((rule) => ({
          ruleId: rule.id,
          eventType: rule.event_type,
          minSeverity: rule.min_severity,
        })),
    }));
  });

  return <NotificationSettings channels={channels} />;
}
