import type { ReactElement } from 'react';
import { subscriberHealth } from '@nx-verify/core';
import { OperatorHealth, type HealthRowView } from '../../../../components/operator-health';
import { operatorQuery, requireOperator } from '../../../../lib/operator';

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

  return <OperatorHealth rows={view} windowHours={WINDOW_HOURS} />;
}
