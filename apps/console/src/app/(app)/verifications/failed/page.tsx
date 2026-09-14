import type { ReactElement } from 'react';
import { countRuns, listProducts, pageRecentRuns } from '@nx-verify/core';
import { VerificationsLog } from '../../../../components/verifications-log';
import { SectionTabs } from '../../../../components/section-tabs';
import { VERIFICATION_TABS } from '../../../../components/nav';
import { query } from '../../../../lib/context';
import { pageRequestFrom } from '../../../../lib/pagination';

/** Never prerendered: one subscriber's live runs. */
export const dynamic = 'force-dynamic';

/**
 * The operations that could not be carried out (handoff screen 00, «العمليات المتعثرة»).
 *
 * The same log, narrowed to runs that ended in error. None of them was charged, and each is
 * run again from its customer's file, by the button of the section it belongs to.
 */
export default async function FailedRunsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const product =
    typeof params['product'] === 'string' && params['product'] !== '' ? params['product'] : null;

  const data = await query(async (tx) => ({
    // Sequential: one connection, one transaction, one query at a time.
    page: await pageRecentRuns(
      tx,
      { productCode: product, status: 'ERROR' },
      pageRequestFrom(params),
    ),
    counts: await countRuns(tx),
    products: await listProducts(tx),
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={VERIFICATION_TABS} current="/verifications/failed" label="أقسام التحقق" />
      <VerificationsLog
        view={{
          page: data.page,
          params,
          counts: data.counts,
          products: data.products.map((entry) => ({ code: entry.code, nameAr: entry.nameAr })),
          filter: { product, status: 'ERROR' },
          highlight: null,
          mode: 'failed',
        }}
      />
    </div>
  );
}
