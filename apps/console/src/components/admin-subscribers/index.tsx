import type { ReactElement } from 'react';
import type { SubscriberBoardRow, SubscribersBoard } from '@nx-verify/core';
import { PageHeader } from '../page-header';
import { ButtonLink } from '../ui/button';
import { Card } from '../ui/card';
import { Ltr } from '../ui/ltr';
import { Table, Th } from '../ui/table';
import { Tag } from '../ui/tag';
import { count } from '../format';
import { NewSubscriberDialog, type NewSubscriberState } from './dialogs';
import {
  STANDING_TAGS,
  activeLineAr,
  balanceCellAr,
  endsAr,
  planCellAr,
  revenueLineAr,
  wholeRiyalsAr,
} from './model';

/**
 * The subscribers and their balances (handoff screen 06), on the administration panel's dark
 * ground.
 *
 * Four figures, then every subscriber with its plan, what is left, when its term ends, thirty
 * days of use, whether a special price applies and where it stands. The attention card counts
 * the rows whose tag is not «نشط», so the figure and the table never disagree.
 */

export interface AdminSubscribersView {
  board: SubscribersBoard;
  expiringWindowDays: number;
  canManage: boolean;
  plans: readonly { code: string; nameAr: string }[];
}

export function SubscriberRow({ row }: { row: SubscriberBoardRow }): ReactElement {
  const standing = STANDING_TAGS[row.standing];
  return (
    <tr data-role="subscriber-row" data-standing={row.standing}>
      <td>{row.legalName}</td>
      <td>{planCellAr(row)}</td>
      <td>
        <Ltr>{balanceCellAr(row)}</Ltr>
      </td>
      <td>{endsAr(row)}</td>
      <td>
        <Ltr>{count(row.runs30)}</Ltr>
      </td>
      <td>{row.hasSpecialPrice ? 'نعم' : 'لا'}</td>
      <td>
        <Tag tone={standing.tone} role="subscriber-standing">
          {standing.labelAr}
        </Tag>
      </td>
      <td>
        <a href={`/operator/subscribers/${row.tenantId}`} className="admin-row-link">
          إدارة
        </a>
      </td>
    </tr>
  );
}

export function AdminSubscribers({
  view,
  createAction,
}: {
  view: AdminSubscribersView;
  createAction: (state: NewSubscriberState, formData: FormData) => Promise<NewSubscriberState>;
}): ReactElement {
  const { board } = view;
  const revenue = revenueLineAr(board.revenue.changePct, board.revenue.lastMonthStart);

  return (
    <div className="admin-screen" data-role="admin-subscribers">
      <PageHeader
        title="المشتركون"
        subtitle={activeLineAr(board.active, board.expiringSoon, view.expiringWindowDays)}
        action={
          <div className="admin-head-actions">
            <ButtonLink href="/operator/subscribers/export" data-role="export-subscribers">
              تصدير
            </ButtonLink>
            {view.canManage ? (
              <NewSubscriberDialog action={createAction} plans={view.plans} />
            ) : null}
          </div>
        }
      />

      <section className="admin-stats" data-role="subscriber-figures" aria-label="أرقام المشتركين">
        <Card variant="stat" as="article" role="month-revenue">
          <p className="admin-stat-label">إيراد الشهر</p>
          <p className="admin-stat-value">
            <Ltr>{wholeRiyalsAr(board.revenue.thisMonthHalalas)}</Ltr>
          </p>
          <p className="admin-stat-line" data-tone={revenue.tone}>
            {revenue.textAr}
          </p>
        </Card>
        <Card variant="stat" as="article" role="month-runs">
          <p className="admin-stat-label">عمليات التحقق</p>
          <p className="admin-stat-value">
            <Ltr>{count(board.runsThisMonth)}</Ltr>
          </p>
          <p className="admin-stat-line">هذا الشهر</p>
        </Card>
        <Card variant="stat" as="article" role="unconsumed">
          <p className="admin-stat-label">رصيد غير مستهلك</p>
          <p className="admin-stat-value">
            <Ltr>{count(board.unconsumedOperations)}</Ltr>
          </p>
          <p className="admin-stat-line">عملية عبر كل المشتركين</p>
        </Card>
        <Card variant="stat" as="article" tone="attention" role="needs-action">
          <p className="admin-stat-label">تحتاج إجراء</p>
          <p className="admin-stat-value">
            <Ltr>{count(board.needsAction)}</Ltr>
          </p>
          <p className="admin-stat-line">رصيد منخفض أو اشتراك منتهٍ</p>
        </Card>
      </section>

      <Card variant="flush" role="subscribers" label="المشتركون">
        {board.rows.length === 0 ? (
          <p className="admin-empty" data-role="empty-state">
            {view.canManage ? 'لا مشترك بعد. أضف أول مشترك من «مشترك جديد».' : 'لا مشترك بعد.'}
          </p>
        ) : (
          <div className="admin-subscribers-table">
            <Table label="المشتركون">
              <thead>
                <tr>
                  <Th>المشترك</Th>
                  <Th>الباقة</Th>
                  <Th>الرصيد المتبقي</Th>
                  <Th>ينتهي في</Th>
                  <Th>استهلاك 30 يوماً</Th>
                  <Th>سعر خاص</Th>
                  <Th>الحالة</Th>
                  <Th>
                    <span className="visually-hidden">إدارة</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {board.rows.map((row) => (
                  <SubscriberRow key={row.tenantId} row={row} />
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
