import type { ReactElement } from 'react';
import { platformOverview } from '@nx-verify/core';
import { OperatorOverview, type AttentionSubscriber } from '../../../components/operator-overview';
import { operatorQuery, requireOperator } from '../../../lib/operator';

/** Never prerendered, and refuses to render without an operator sign in. */
export const dynamic = 'force-dynamic';

export default async function OperatorOverviewPage(): Promise<ReactElement> {
  await requireOperator();
  const overview = await operatorQuery((db) => platformOverview(db));

  const pick = (row: AttentionSubscriber): AttentionSubscriber => ({
    tenantId: row.tenantId,
    legalName: row.legalName,
    daysLeft: row.daysLeft,
    availableHalalas: row.availableHalalas,
    transactionsUsed: row.transactionsUsed,
    includedTransactions: row.includedTransactions,
  });

  return (
    <OperatorOverview
      view={{
        subscribers: overview.subscribers,
        month: overview.month,
        renewalsDue: overview.renewalsDue.map(pick),
        lapsed: overview.lapsed.map(pick),
        lowBalance: overview.lowBalance.map(pick),
        nearCapacity: overview.nearCapacity.map(pick),
        pendingTopUps: overview.pendingTopUps,
        busiest: overview.busiest,
      }}
    />
  );
}
