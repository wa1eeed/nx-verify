import type { ReactElement } from 'react';
import { NoAccess } from '../../../../components/no-access';
import { listMonitors, listProducts } from '@nx-verify/core';
import { Monitors, type MonitorRowView } from '../../../../components/monitors';
import { actingUser, query } from '../../../../lib/context';
import { SectionTabs } from '../../../../components/section-tabs';
import { CUSTOMER_TABS, visible } from '../../../../components/nav';
import { pauseMonitorAction, raiseMonitorBudgetAction, resumeMonitorAction } from './actions';

/** Never prerendered: one workspace's live monitors. */
export const dynamic = 'force-dynamic';

export default async function MonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string }>;
}): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('customers.read')) {
    return <NoAccess needs="customers.read" />;
  }
  const { outcome } = await searchParams;

  const rows = await query(async (tx) => {
    const monitors = await listMonitors(tx);
    if (monitors.length === 0) {
      return [] as MonitorRowView[];
    }

    const products = await listProducts(tx);
    const productName = new Map(products.map((product) => [product.code, product.nameAr]));

    const ids = [...new Set(monitors.map((monitor) => monitor.entityId))];
    const { rows: names } = await tx.query<{ id: string; display_name: string | null }>(
      `SELECT id, display_name FROM entities WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tx.tenantId, ids],
    );
    const nameOf = new Map(names.map((row) => [row.id, row.display_name]));

    return monitors.map((monitor): MonitorRowView => ({
      id: monitor.id,
      entityId: monitor.entityId,
      entityName: nameOf.get(monitor.entityId) ?? null,
      productNameAr: productName.get(monitor.productCode) ?? monitor.productCode,
      fieldPaths: monitor.fieldPaths,
      cadence: monitor.cadence,
      nextRunAt: monitor.nextRunAt,
      budgetCap: monitor.budgetCap,
      spentThisPeriod: monitor.spentThisPeriod,
      status: monitor.status,
    }));
  });

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={visible(CUSTOMER_TABS, actor.capabilities)} current="/customers/monitoring" label="أقسام العملاء" />
      <Monitors
        rows={rows}
        outcome={outcome}
        pauseAction={pauseMonitorAction}
        resumeAction={resumeMonitorAction}
        raiseBudgetAction={raiseMonitorBudgetAction}
      />
    </div>
  );
}
