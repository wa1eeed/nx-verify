import type { ReactElement } from 'react';
import { EXPIRING_WINDOW_DAYS, listPlans, operatorCan, subscribersBoard } from '@nx-verify/core';
import { AdminSubscribers } from '../../../../components/admin-subscribers';
import { SectionTabs } from '../../../../components/section-tabs';
import { SUBSCRIBER_TABS } from '../../../../components/operator-shell';
import { currentOperator, operatorQuery } from '../../../../lib/operator';
import { createSubscriberAction } from './actions';

/** Never prerendered, and refuses to render without a sign in. */
export const dynamic = 'force-dynamic';

/**
 * The subscribers and their balances (handoff screen 06).
 *
 * Read on the operator connection from commercial rows and monthly counters only (ADR-118).
 */
export default async function OperatorSubscribersPage(): Promise<ReactElement> {
  const operator = await currentOperator();
  const data = await operatorQuery(async (db) => ({
    board: await subscribersBoard(db),
    plans: await listPlans(db),
  }));

  return (
    <div className="admin-screen">
      <SectionTabs tabs={SUBSCRIBER_TABS} current="/operator/subscribers" label="أقسام المشتركين" />
      <AdminSubscribers
        view={{
          board: data.board,
          expiringWindowDays: EXPIRING_WINDOW_DAYS,
          canManage: operatorCan(operator.role, 'subscribers'),
          plans: data.plans.map((plan) => ({ code: plan.code, nameAr: plan.nameAr })),
        }}
        createAction={createSubscriberAction}
      />
    </div>
  );
}
