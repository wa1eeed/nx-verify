import type { ReactElement } from 'react';
import {
  EXPIRING_WINDOW_DAYS,
  countPendingSandboxRequests,
  listPlans,
  operatorCan,
  slicePage,
  subscribersBoard,
} from '@nx-verify/core';
import { pageRequestFrom, type SearchParams } from '../../../../lib/pagination';
import { AdminSubscribers } from '../../../../components/admin-subscribers';
import { SectionTabs } from '../../../../components/section-tabs';
import { SUBSCRIBER_TABS, subscriberTabCounts } from '../../../../components/operator-shell';
import { operatorOrSignIn, operatorQuery } from '../../../../lib/operator';
import { createSubscriberAction } from './actions';

/** Never prerendered, and refuses to render without a sign in. */
export const dynamic = 'force-dynamic';

/**
 * The subscribers and their balances (handoff screen 06).
 *
 * Read on the operator connection from commercial rows and monthly counters only (ADR-118).
 */
export default async function OperatorSubscribersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<ReactElement> {
  const operator = await operatorOrSignIn();
  const params = await searchParams;
  const data = await operatorQuery(async (db) => ({
    board: await subscribersBoard(db),
    plans: await listPlans(db),
    // This is the screen the sidebar's count drops somebody on, and no ask appears on it. A
    // counter, not a list (ADR-186): the tab that lists them carries the number instead.
    waiting: await countPendingSandboxRequests(db),
  }));

  return (
    <div className="admin-screen">
      <SectionTabs
        tabs={SUBSCRIBER_TABS}
        current="/operator/subscribers"
        label="أقسام المشتركين"
        counts={subscriberTabCounts(data.waiting)}
      />
      <AdminSubscribers
        view={{
          board: data.board,
          page: slicePage(data.board.rows, pageRequestFrom(params)),
          params,
          expiringWindowDays: EXPIRING_WINDOW_DAYS,
          canManage: operatorCan(operator.role, 'subscribers'),
          plans: data.plans.map((plan) => ({ code: plan.code, nameAr: plan.nameAr })),
        }}
        createAction={createSubscriberAction}
      />
    </div>
  );
}
