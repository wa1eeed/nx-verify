import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { countCustomers, listCustomers, type CustomerKind } from '@nx-verify/core';
import { query } from '../../../lib/context';
import { getKeys } from '../../../lib/keys';
import { Customers, type CustomersFilter } from '../../../components/customers';
import { SectionTabs } from '../../../components/section-tabs';
import { CUSTOMER_TABS } from '../../../components/nav';

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
 * The related records behind them moved to their own tab; an old address that still asks
 * for one of those views is sent there rather than shown an empty list.
 */

const KINDS = new Set<CustomerKind>(['COMPANY', 'ESTABLISHMENT', 'FREELANCER']);

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; kind?: string; q?: string }>;
}): Promise<ReactElement> {
  const params = await searchParams;

  if (params.view !== undefined) {
    redirect(`/customers/relations?view=${encodeURIComponent(params.view)}`);
  }

  const kind = KINDS.has(params.kind as CustomerKind) ? (params.kind as CustomerKind) : null;
  const search = (params.q ?? '').trim().slice(0, 80);
  const data = await query(async (tx) => ({
    rows: await listCustomers(tx, getKeys(), { kind, search, limit: 200 }),
    counts: await countCustomers(tx),
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <SectionTabs tabs={CUSTOMER_TABS} current="/customers" label="أقسام العملاء" />
      <Customers
        view={{
          rows: data.rows,
          counts: data.counts,
          filter: (kind ?? 'all') as CustomersFilter,
          search,
          now: new Date(),
        }}
      />
    </div>
  );
}
