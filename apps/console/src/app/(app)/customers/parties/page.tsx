import type { ReactElement } from 'react';
import { endRoleAction } from './actions';
import { NoAccess } from '../../../../components/no-access';
import { slicePage, summarizeParties, type PartyRole } from '@nx-verify/core';
import { pageRequestFrom } from '../../../../lib/pagination';
import { actingUser, query } from '../../../../lib/context';
import { getKeys } from '../../../../lib/keys';
import { Parties, type PartiesFilter } from '../../../../components/parties';
import { SectionTabs } from '../../../../components/section-tabs';
import { CUSTOMER_TABS, visible } from '../../../../components/nav';
import { searchPartiesAction } from '../actions';

/** Never prerendered and never cached: one subscriber's live records. */
export const dynamic = 'force-dynamic';

/**
 * The related parties of a subscriber's customers (the owner's ask).
 *
 * Summarised once, and the filters, the counts and the rows are all read from those
 * summaries, as the customers are, so the counts beside the filters add up to what they show.
 */

const ROLES = new Set<PartyRole>(['MANAGER', 'PARTNER', 'LIQUIDATOR', 'GUARDIAN']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PartiesPage({
  searchParams,
}: {
  searchParams: Promise<{
    role?: string;
    q?: string;
    concerns?: string;
    several?: string;
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
  const role = ROLES.has(params.role as PartyRole) ? (params.role as PartyRole) : null;
  const concernsOnly = params.concerns === '1';
  const severalOnly = params.several === '1';
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

  const all = await query((tx) => summarizeParties(tx, getKeys()));
  const needle = search.toLowerCase();
  const rows = all
    .filter(
      (party) =>
        (role === null || party.roleCounts[role] > 0) &&
        (!concernsOnly || party.concerns > 0) &&
        (!severalOnly || party.companies.length > 1) &&
        (ids === null || ids.has(party.entityId)) &&
        (needle === '' || (party.displayName ?? '').toLowerCase().includes(needle)),
    )
    // Whoever stands behind the most companies first: that is where a link matters most.
    .sort(
      (left, right) =>
        right.companies.length - left.companies.length ||
        (left.displayName ?? '').localeCompare(right.displayName ?? '', 'ar'),
    );

  return (
    <div className="stack" style={{ gap: 'var(--layout-content-gap)' }}>
      <SectionTabs tabs={visible(CUSTOMER_TABS, actor.capabilities)} current="/customers/parties" label="أقسام العملاء" />
      <Parties
        view={{
          page: slicePage(rows, pageRequestFrom(params)),
          params,
          counts: {
            all: all.length,
            MANAGER: all.filter((party) => party.roleCounts.MANAGER > 0).length,
            PARTNER: all.filter((party) => party.roleCounts.PARTNER > 0).length,
            LIQUIDATOR: all.filter((party) => party.roleCounts.LIQUIDATOR > 0).length,
            GUARDIAN: all.filter((party) => party.roleCounts.GUARDIAN > 0).length,
            concerns: all.filter((party) => party.concerns > 0).length,
            several: all.filter((party) => party.companies.length > 1).length,
          },
          filter: (role ?? 'all') as PartiesFilter,
          // Absent for somebody who may look but not decide: ending a role changes what a
          // customer file says and what its risk signals count (ADR-168).
          ...(actor.can('review.decide') ? { endRoleAction } : {}),
          concernsOnly,
          severalOnly,
          search,
          searchedByNumber: ids !== null,
          searchAction: searchPartiesAction,
        }}
      />
    </div>
  );
}
