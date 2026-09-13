import type { ReactElement } from 'react';
import { listApiRequests } from '@nx-verify/core';
import { ApiLog, type ApiLogRowView } from '../../../../components/api-log';
import { query } from '../../../../lib/context';
import { SectionTabs } from '../../../../components/section-tabs';
import { DEVELOPER_TABS } from '../../../../components/nav';

export const dynamic = 'force-dynamic';

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const failuresOnly = params['failures'] !== undefined;

  const rows = await query(async (tx): Promise<ApiLogRowView[]> => {
    const log = await listApiRequests(tx, { limit: 200, failuresOnly });
    return log.map((row) => ({
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
  });

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={DEVELOPER_TABS} current="/developers/logs" label="أقسام المطوّرين" />
      <ApiLog rows={rows} failuresOnly={failuresOnly} />
    </div>
  );
}
