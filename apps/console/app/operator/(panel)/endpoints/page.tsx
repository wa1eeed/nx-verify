import type { ReactElement } from 'react';
import { listCatalog } from '@nx-verify/core';
import { listProviderEndpoints } from '@nx-verify/providers';
import { PageHeader } from '../../../../components/page-header';
import {
  OperatorEndpoints,
  type EndpointRowView,
  type EndpointsView,
} from '../../../../components/operator-endpoints';
import { operatorQuery, requireOperator } from '../../../../lib/operator';
import { setEndpointAction } from './actions';
import { SectionTabs } from '../../../../components/section-tabs';
import { INTEGRATION_TABS } from '../../../../components/operator-shell';

/** Never prerendered, and refuses to render without an operator token. */
export const dynamic = 'force-dynamic';

export default async function OperatorEndpointsPage(): Promise<ReactElement> {
  await requireOperator();

  const data = await operatorQuery(async (db) => {
    const catalog = await listCatalog(db);
    const sandbox = await listProviderEndpoints(db, 'sandbox');
    const live = await listProviderEndpoints(db, 'live');
    // The endpoints product steps actually ask for. Offering any others would invite
    // somebody to configure a call nothing will ever make.
    const { rows } = await db.query<{ endpoint: string }>(
      `SELECT DISTINCT endpoint FROM product_steps ORDER BY endpoint`,
    );
    return { catalog, rows: [...sandbox, ...live], required: rows.map((row) => row.endpoint) };
  });

  const view: EndpointsView = {
    providers: data.catalog.map((entry) => entry.code),
    required: data.required,
    rows: data.rows.map((row): EndpointRowView => ({
      provider: row.provider,
      environment: row.environment,
      endpoint: row.endpoint,
      method: row.method,
      path: row.path,
      authority: row.authority,
      dataPath: row.dataPath,
      fieldMap: row.fieldMap,
      bodyMap: row.bodyMap,
    })),
  };

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs
        tabs={INTEGRATION_TABS}
        current="/operator/endpoints"
        label="أقسام الربط التقني"
      />
      <div className="stack" style={{ gap: 'var(--s-5)' }}>
        <PageHeader
          title="خريطة نقاط النهاية"
          subtitle="أين يذهب كل نداء عند كل مزوّد، وكيف تُقرأ إجابته. يُغيَّر من هنا بلا إعادة نشر."
        />
        <OperatorEndpoints view={view} setEndpointAction={setEndpointAction} />
      </div>
    </div>
  );
}
