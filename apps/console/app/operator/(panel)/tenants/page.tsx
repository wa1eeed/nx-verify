import type { ReactElement } from 'react';
import { listSubscriberSummaries } from '@nx-verify/core';
import { OperatorTenants } from '../../../../components/operator-tenants';
import { operatorQuery, requireOperator } from '../../../../lib/operator';

/** Never prerendered, and refuses to render without an operator sign in. */
export const dynamic = 'force-dynamic';

export default async function OperatorTenantsPage(): Promise<ReactElement> {
  await requireOperator();
  const rows = await operatorQuery((db) => listSubscriberSummaries(db));

  return (
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
  );
}
