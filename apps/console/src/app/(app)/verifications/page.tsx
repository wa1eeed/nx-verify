import type { ReactElement } from 'react';
import { NoAccess } from '../../../components/no-access';
import { countRuns, listProducts, pageRecentRuns } from '@nx-verify/core';
import { VerificationsLog } from '../../../components/verifications-log';
import { SectionTabs } from '../../../components/section-tabs';
import { VERIFICATION_TABS, visible } from '../../../components/nav';
import { actingUser, query } from '../../../lib/context';
import { pageRequestFrom } from '../../../lib/pagination';

/** Never prerendered: one subscriber's live runs. */
export const dynamic = 'force-dynamic';

const STATUSES = new Set(['OK', 'PARTIAL', 'NOT_FOUND', 'ERROR', 'AWAITING', 'PENDING']);

export default async function VerificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('customers.read')) {
    return <NoAccess needs="customers.read" />;
  }
  const params = await searchParams;
  const product =
    typeof params['product'] === 'string' && params['product'] !== '' ? params['product'] : null;
  const status =
    typeof params['status'] === 'string' && STATUSES.has(params['status'])
      ? params['status']
      : null;
  const highlight = typeof params['run'] === 'string' ? params['run'] : null;

  const data = await query(async (tx) => ({
    // Sequential: one connection, one transaction, one query at a time.
    page: await pageRecentRuns(tx, { productCode: product, status }, pageRequestFrom(params)),
    counts: await countRuns(tx),
    products: await listProducts(tx),
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={visible(VERIFICATION_TABS, actor.capabilities)} current="/verifications" label="أقسام التحقق" />
      <VerificationsLog
        view={{
          page: data.page,
          params,
          counts: data.counts,
          products: data.products.map((entry) => ({ code: entry.code, nameAr: entry.nameAr })),
          filter: { product, status },
          highlight,
        }}
      />
    </div>
  );
}
