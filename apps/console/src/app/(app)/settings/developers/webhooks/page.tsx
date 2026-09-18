import type { ReactElement } from 'react';
import { NoAccess } from '../../../../../components/no-access';
import { listAllEndpoints } from '@nx-verify/core';
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
  const endpoints = await query(async (tx) =>
    (await listAllEndpoints(tx)).map((endpoint): EndpointView => ({
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      status: endpoint.status,
      // The secret reference is deliberately not carried to the screen. It is a pointer to
      // the signing secret, and a pointer on a page is one lookup from the thing itself.
    })),
  );

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
