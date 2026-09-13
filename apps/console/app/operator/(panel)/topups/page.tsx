import type { ReactElement } from 'react';
import { listPendingTopUps } from '@nx-verify/core';
import { PageHeader } from '../../../../components/page-header';
import { PendingTopUps, type PendingTopUpView } from '../../../../components/topup';
import { operatorQuery, requireOperator } from '../../../../lib/operator';
import { confirmTopUpAction, rejectTopUpAction } from './actions';

/** Never prerendered, and refuses to render without an operator token. */
export const dynamic = 'force-dynamic';

export default async function OperatorTopUpsPage(): Promise<ReactElement> {
  await requireOperator();

  const pending = await operatorQuery((db) => listPendingTopUps(db));

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
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="الحوالات"
        subtitle="طلبات شحن الرصيد بانتظار تأكيد وصول الحوالة."
      />
      <PendingTopUps
        pending={view}
        confirmAction={confirmTopUpAction}
        rejectAction={rejectTopUpAction}
      />
    </div>
  );
}
