import type { ReactElement } from 'react';
import { NoAccess } from '../../../../components/no-access';
import { listApiKeys } from '@nx-verify/core';
import { ApiKeys, type ApiKeyView } from '../../../../components/api-keys';
import { actingUser, query } from '../../../../lib/context';
import { issueKeyAction, revokeKeyAction } from './actions';
import { SectionTabs } from '../../../../components/section-tabs';
import { DEVELOPER_TABS, SETTINGS_TABS, visible } from '../../../../components/nav';

/** Never prerendered: one workspace's credentials, read at request time. */
export const dynamic = 'force-dynamic';

export default async function ApiKeysPage(): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('developers.manage')) {
    return <NoAccess needs="developers.manage" />;
  }
  const keys = await query(async (tx) =>
    (await listApiKeys(tx)).map((key): ApiKeyView => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: key.scopes,
      environment: key.environment,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
    })),
  );

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={visible(SETTINGS_TABS, actor.capabilities)} current="/settings/developers" label="أقسام الإعدادات" />
      <SectionTabs
        tabs={visible(DEVELOPER_TABS, actor.capabilities)}
        current="/settings/developers"
        label="أقسام مفاتيح الربط"
      />
      <ApiKeys keys={keys} issueAction={issueKeyAction} revokeAction={revokeKeyAction} />
    </div>
  );
}
