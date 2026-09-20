import type { ReactElement } from 'react';
import { countPendingSandboxRequests, listPendingTopUps } from '@nx-verify/core';
import { PageHeader } from '../../../../../components/page-header';
import {
  PendingTopUps,
  bundleLabelOf,
  type PendingTopUpView,
} from '../../../../../components/topup';
import { operatorOrSignIn, operatorQuery } from '../../../../../lib/operator';
import { confirmTopUpAction, rejectTopUpAction } from './actions';
import { topUpNoticeAr } from './notice';
import { Notice } from '../../../../../components/ui/notice';
import { SectionTabs } from '../../../../../components/section-tabs';
import { SUBSCRIBER_TABS, subscriberTabCounts } from '../../../../../components/operator-shell';

/** Never prerendered, and refuses to render without an operator token. */
export const dynamic = 'force-dynamic';

export default async function OperatorTopUpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  await operatorOrSignIn();

  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };

  const { pending, waiting } = await operatorQuery(async (db) => ({
    pending: await listPendingTopUps(db),
    // The other queue of this section, counted rather than listed, so its tab says how many
    // are waiting on a screen that is not this one (ADR-186).
    waiting: await countPendingSandboxRequests(db),
  }));
  const notice = topUpNoticeAr({ refused: one('refused'), saved: one('saved') });

  const view: PendingTopUpView[] = pending.map((request) => ({
    id: request.id,
    tenantId: request.tenantId,
    tenantName: request.tenantName,
    reference: request.reference,
    amountHalalas: request.amountHalalas,
    totalWithVatHalalas: request.totalWithVatHalalas,
    status: request.status,
    requestedAt: request.requestedAt,
    vatInvoiceId: request.vatInvoiceId,
    note: request.note,
    bundleLabel: bundleLabelOf(request.bundleCode),
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <SectionTabs
        tabs={SUBSCRIBER_TABS}
        current="/operator/subscribers/topups"
        label="أقسام المشتركين"
        counts={subscriberTabCounts(waiting)}
      />
      <PageHeader title="الحوالات" subtitle="طلبات شحن الرصيد بانتظار تأكيد وصول الحوالة." />
      {/*
        The screen had no notice channel at all: an empty invoice number returned silently and
        the row simply sat there, and a confirmation that worked looked identical (ADR-166).
      */}
      {notice === null ? null : (
        <Notice tone={notice.tone} role="topup-notice">
          {notice.text}
        </Notice>
      )}
      <PendingTopUps
        pending={view}
        confirmAction={confirmTopUpAction}
        rejectAction={rejectTopUpAction}
      />
    </div>
  );
}
