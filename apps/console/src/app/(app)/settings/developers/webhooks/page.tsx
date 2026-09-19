import type { ReactElement } from 'react';
import { NoAccess } from '../../../../../components/no-access';
import { endpointHealth, listAllEndpoints } from '@nx-verify/core';
import { Webhooks, type EndpointView } from '../../../../../components/webhooks';
import { actingUser, query } from '../../../../../lib/context';
import { SectionTabs } from '../../../../../components/section-tabs';
import { DEVELOPER_TABS, SETTINGS_TABS, visible } from '../../../../../components/nav';
import { addEndpointAction, pauseEndpointAction, resumeEndpointAction } from './actions';

/** Never prerendered: one workspace's endpoints, read at request time. */
export const dynamic = 'force-dynamic';

export default async function WebhooksPage(): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('developers.manage')) {
    return <NoAccess needs="developers.manage" />;
  }
  const endpoints = await query(async (tx) => {
    const rows = await listAllEndpoints(tx);
    // What actually arrived. The deliveries table recorded every attempt and nothing read it,
    // so a subscriber registered an address and was blind to whether one event ever landed
    // (ADR-169).
    const health = new Map((await endpointHealth(tx)).map((row) => [row.endpointId, row]));
    return rows.map((endpoint): EndpointView => {
      const found = health.get(endpoint.id);
      return {
        id: endpoint.id,
        url: endpoint.url,
        events: endpoint.events,
        status: endpoint.status,
        health:
          found === undefined
            ? null
            : {
                delivered: found.delivered,
                failing: found.failing,
                abandoned: found.abandoned,
                pending: found.pending,
                lastDeliveredAt: found.lastDeliveredAt,
                lastStatus: found.lastStatus,
              },
        // The secret reference is deliberately not carried to the screen. It is a pointer to
        // the signing secret, and a pointer on a page is one lookup from the thing itself.
      };
    });
  });

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={visible(SETTINGS_TABS, actor.capabilities)} current="/settings/developers" label="أقسام الإعدادات" />
      <SectionTabs
        tabs={visible(DEVELOPER_TABS, actor.capabilities)}
        current="/settings/developers/webhooks"
        label="أقسام مفاتيح الربط"
      />
      <Webhooks
        endpoints={endpoints}
        addAction={addEndpointAction}
        pauseAction={pauseEndpointAction}
        resumeAction={resumeEndpointAction}
      />
    </div>
  );
}
