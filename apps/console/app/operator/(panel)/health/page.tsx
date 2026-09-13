import type { ReactElement } from 'react';
import { subscriberHealth } from '@nx-verify/core';
import { OperatorHealth, type HealthRowView } from '../../../../components/operator-health';
import { operatorQuery, requireOperator } from '../../../../lib/operator';
import { SectionTabs } from '../../../../components/section-tabs';
import { INTEGRATION_TABS } from '../../../../components/operator-shell';

/** Never prerendered, and refuses to render without an operator token. */
export const dynamic = 'force-dynamic';

const WINDOW_HOURS = 24;

export default async function OperatorHealthPage(): Promise<ReactElement> {
  await requireOperator();

  const rows = await operatorQuery((db) => subscriberHealth(db, { windowHours: WINDOW_HOURS }));

  const view: HealthRowView[] = rows.map((row) => ({
    tenantId: row.tenantId,
    legalName: row.legalName,
    slug: row.slug,
    isSandbox: row.isSandbox,
    calls: row.calls,
    failures: row.failures,
    slowestMs: row.slowestMs,
    balanceHalalas: row.balanceHalalas,
    heldHalalas: row.heldHalalas,
    balanceLow: row.balanceLow,
    unhealthyProviders: row.unhealthyProviders,
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={INTEGRATION_TABS} current="/operator/health" label="أقسام الربط التقني" />
      <OperatorHealth rows={view} windowHours={WINDOW_HOURS} />
    </div>
  );
}
