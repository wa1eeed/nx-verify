import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { slicePage, summarizeCustomers, type CustomerKind } from '@nx-verify/core';
import { pageRequestFrom } from '../../../lib/pagination';
import { query } from '../../../lib/context';
import { getKeys } from '../../../lib/keys';
import { Customers, type CustomersFilter } from '../../../components/customers';
import { SectionTabs } from '../../../components/section-tabs';
import { CUSTOMER_TABS } from '../../../components/nav';
import { searchCustomersAction } from './actions';

/**
 * Never prerendered and never cached.
 *
 * This page reads one tenant's live data, and a build machine has no database and no
 * business holding a copy of it.
 */
export const dynamic = 'force-dynamic';

/**
 * The customers a subscriber verified (handoff screen 04).
 *
 * Every customer is summarised once, and the filters, the counts and the rows are all read
 * from those summaries, so the counts beside the filters always add up to what the filters
 * show. The related records behind them moved to their own tab; an old address that still
 * asks for one of those views is sent there rather than shown an empty list.
 */

const KINDS = new Set<CustomerKind>(['COMPANY', 'ESTABLISHMENT', 'FREELANCER']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    kind?: string;
    q?: string;
    alerts?: string;
    ids?: string;
    page?: string;
    size?: string;
  }>;
}): Promise<ReactElement> {
  const params = await searchParams;

  if (params.view !== undefined) {
    redirect(`/customers/relations?view=${encodeURIComponent(params.view)}`);
  }

  const kind = KINDS.has(params.kind as CustomerKind) ? (params.kind as CustomerKind) : null;
  const alertsOnly = params.alerts === '1';
  const search = (params.q ?? '').trim().slice(0, 80);
  const ids =
    params.ids === undefined
      ? null
      : new Set(
          params.ids
            .split(',')
            .filter((id) => UUID.test(id))
            .slice(0, 20),
        );

  const all = await query((tx) => summarizeCustomers(tx, getKeys(), { limit: 5_000 }));

  const needle = search.toLowerCase();
  const rows = all.filter(
    (summary) =>
      (kind === null || summary.kind === kind) &&
      (!alertsOnly || summary.openAlerts > 0) &&
      (ids === null || ids.has(summary.entityId)) &&
      (needle === '' || (summary.displayName ?? '').toLowerCase().includes(needle)),
  );
  const complete = all.filter((summary) => summary.completeness === 100).length;

  return (
    <div className="stack" style={{ gap: 'var(--layout-content-gap)' }}>
      <SectionTabs tabs={CUSTOMER_TABS} current="/customers" label="أقسام العملاء" />
      <Customers
        view={{
          page: slicePage(rows, pageRequestFrom(params)),
          params,
          counts: {
            all: all.length,
            companies: all.filter((summary) => summary.kind === 'COMPANY').length,
            establishments: all.filter((summary) => summary.kind === 'ESTABLISHMENT').length,
            freelancers: all.filter((summary) => summary.kind === 'FREELANCER').length,
            complete,
            incomplete: all.length - complete,
            alerts: all.filter((summary) => summary.openAlerts > 0).length,
          },
          filter: (kind ?? 'all') as CustomersFilter,
          alertsOnly,
          search,
          searchedByNumber: ids !== null,
          searchAction: searchCustomersAction,
        }}
      />
    </div>
  );
}
