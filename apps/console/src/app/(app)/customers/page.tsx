import type { ReactElement } from 'react';
import { NoAccess } from '../../../components/no-access';
import { redirect } from 'next/navigation';
import {
  countCustomers,
  pageWindow,
  pickCustomers,
  riskModelVersion,
  summarizeCustomers,
  writeStanding,
  type CustomerKind,
} from '@nx-verify/core';
import { pageRequestFrom } from '../../../lib/pagination';
import { actingUser, query } from '../../../lib/context';
import { getKeys } from '../../../lib/keys';
import { Customers, type CustomersFilter } from '../../../components/customers';
import { SectionTabs } from '../../../components/section-tabs';
import { CUSTOMER_TABS, visible } from '../../../components/nav';
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
 * One page is chosen in the database and only that page is summarised (ADR-140). It used to
 * ask for five thousand summaries whatever page it was showing, filter them in JavaScript and
 * slice the result in memory, which is why at fifty thousand customers the screen stopped
 * answering at all.
 *
 * The counts beside the filters come from one row per customer rather than from the summaries,
 * so they still add up to what the filters show. Three of them, «مكتمل», «تنبيهات» and «مخاطر
 * عالية», are the model's answers and are read from the standing the worker keeps: they can lag
 * a sweep behind what a row shows, and a row is never wrong because it is summarised live.
 *
 * The related records behind them moved to their own tab; an old address that still asks for
 * one of those views is sent there rather than shown an empty list.
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
    risk?: string;
    ids?: string;
    page?: string;
    size?: string;
  }>;
}): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('customers.read')) {
    return <NoAccess needs="customers.read" />;
  }
  const params = await searchParams;

  if (params.view !== undefined) {
    redirect(`/customers/relations?view=${encodeURIComponent(params.view)}`);
  }

  const kind = KINDS.has(params.kind as CustomerKind) ? (params.kind as CustomerKind) : null;
  const alertsOnly = params.alerts === '1';
  const highRiskOnly = params.risk === 'high';
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

  const request = pageRequestFrom(params);
  const data = await query(async (tx) => {
    const keys = getKeys();
    const filter = {
      kind,
      alertsOnly,
      highRiskOnly,
      search,
      ...(ids === null ? {} : { entityIds: [...ids] }),
    };
    // Which customers, and how many there are under this filter, before anything is read
    // about any of them.
    const first = await pickCustomers(tx, keys, { ...filter, limit: request.size });
    const window = pageWindow(request, first.total);
    const picked =
      window.offset === 0
        ? first
        : await pickCustomers(tx, keys, { ...filter, limit: window.limit, offset: window.offset });
    // Which risk model this page is about to be summarised under, read before the summary so
    // an edit landing mid page is recorded as the older model rather than the newer (ADR-175).
    const model = await riskModelVersion(tx);
    const rows = await summarizeCustomers(tx, keys, { entityIds: picked.entityIds });
    // The page was summarised live anyway, so its standing is written back rather than thrown
    // away: the list heals whatever anybody actually looks at, and the worker is left with the
    // customers nobody has opened (ADR-140).
    await writeStanding(tx, rows, picked.entityIds, model);
    // Counted after that write, not before it, so the facets agree with the page they sit
    // above. Customers nobody has opened still wait for the worker.
    const counts = await countCustomers(tx);
    return { counts, window, total: picked.total, rows };
  });

  return (
    <div className="stack" style={{ gap: 'var(--layout-content-gap)' }}>
      <SectionTabs
        tabs={visible(CUSTOMER_TABS, actor.capabilities)}
        current="/customers"
        label="أقسام العملاء"
      />
      <Customers
        view={{
          page: {
            rows: data.rows,
            total: data.total,
            page: data.window.page,
            size: request.size,
            pages: data.window.pages,
          },
          params,
          counts: data.counts,
          filter: (kind ?? 'all') as CustomersFilter,
          alertsOnly,
          highRiskOnly,
          search,
          searchedByNumber: ids !== null,
          searchAction: searchCustomersAction,
        }}
      />
    </div>
  );
}
