import type { ReactElement } from 'react';
import { apiLogTallies, pageApiRequests, type Page } from '@nx-verify/core';
import { ApiLog, type ApiLogRowView } from '../../../../../components/api-log';
import { query } from '../../../../../lib/context';
import { pageRequestFrom } from '../../../../../lib/pagination';
import { SectionTabs } from '../../../../../components/section-tabs';
import { DEVELOPER_TABS, SETTINGS_TABS } from '../../../../../components/nav';

export const dynamic = 'force-dynamic';

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const failuresOnly = params['failures'] !== undefined;

  const { page, tallies } = await query(async (tx) => {
    const log = await pageApiRequests(tx, { failuresOnly }, pageRequestFrom(params));
    const tallies = await apiLogTallies(tx, { failuresOnly });
    const rows = log.rows.map((row): ApiLogRowView => ({
      id: row.id,
      requestId: row.requestId,
      method: row.method,
      route: row.route,
      status: row.status,
      latencyMs: row.latencyMs,
      errorCode: row.errorCode,
      environment: row.environment,
      at: row.at,
    }));
    return { page: { ...log, rows } as Page<ApiLogRowView>, tallies };
  });

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={SETTINGS_TABS} current="/settings/developers" label="أقسام الإعدادات" />
      <SectionTabs
        tabs={DEVELOPER_TABS}
        current="/settings/developers/logs"
        label="أقسام مفاتيح الربط"
      />
      <ApiLog page={page} tallies={tallies} params={params} failuresOnly={failuresOnly} />
    </div>
  );
}
