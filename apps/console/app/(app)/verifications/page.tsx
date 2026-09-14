import type { ReactElement } from 'react';
import { countRuns, listProducts, listRecentRuns } from '@nx-verify/core';
import { VerificationsLog } from '../../../components/verifications-log';
import { SectionTabs } from '../../../components/section-tabs';
import { VERIFICATION_TABS } from '../../../components/nav';
import { query } from '../../../lib/context';

/** Never prerendered: one subscriber's live runs. */
export const dynamic = 'force-dynamic';

const STATUSES = new Set(['OK', 'PARTIAL', 'NOT_FOUND', 'ERROR', 'AWAITING', 'PENDING']);

export default async function VerificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
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
    rows: await listRecentRuns(tx, { productCode: product, status, limit: 200 }),
    counts: await countRuns(tx),
    products: await listProducts(tx),
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={VERIFICATION_TABS} current="/verifications" label="أقسام عمليات التحقق" />
      <VerificationsLog
        view={{
          rows: data.rows,
          counts: data.counts,
          products: data.products.map((entry) => ({ code: entry.code, nameAr: entry.nameAr })),
          filter: { product, status },
          highlight,
        }}
      />
    </div>
  );
}
