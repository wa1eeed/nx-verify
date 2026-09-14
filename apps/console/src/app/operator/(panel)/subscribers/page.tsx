import type { ReactElement } from 'react';
import { listSubscriberSummaries } from '@nx-verify/core';
import { OperatorTenants } from '../../../../components/operator-tenants';
import { operatorQuery, requireOperator } from '../../../../lib/operator';
import { SectionTabs } from '../../../../components/section-tabs';
import { SUBSCRIBER_TABS } from '../../../../components/operator-shell';

/** Never prerendered, and refuses to render without an operator sign in. */
export const dynamic = 'force-dynamic';

export default async function OperatorTenantsPage(): Promise<ReactElement> {
  await requireOperator();
  const rows = await operatorQuery((db) => listSubscriberSummaries(db));

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <SectionTabs tabs={SUBSCRIBER_TABS} current="/operator/subscribers" label="أقسام المشتركين" />
      <OperatorTenants
        rows={rows.map((row) => ({
          tenantId: row.tenantId,
          legalName: row.legalName,
          slug: row.slug,
          packageNameAr: row.packageNameAr,
          termEnd: row.termEnd,
          daysLeft: row.daysLeft,
          includedTransactions: row.includedTransactions,
          transactionsUsed: row.transactionsUsed,
          availableHalalas: row.availableHalalas,
          lowBalance: row.lowBalance,
          hasSandbox: row.hasSandbox,
        }))}
      />
    </div>
  );
}
