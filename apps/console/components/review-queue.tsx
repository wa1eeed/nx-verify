import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';

/**
 * The review queue.
 *
 * Ordered by what is late, not by what arrived, because a queue is worked by urgency.
 * The maker and the checker are named on every row that has them, so the control is
 * visible rather than merely enforced: an analyst can see that a colleague decided and
 * that someone else has to approve.
 *
 * One primary action, and it is the one an analyst opens this screen to perform.
 */

export interface QueueRowView {
  caseId: string;
  entityId: string;
  entityName: string | null;
  reasonCodes: string[];
  status: 'OPEN' | 'ASSIGNED' | 'DECIDED' | 'CLOSED';
  assignedTo: string | null;
  decidedBy: string | null;
  ageHours: number;
  overdue: boolean;
}

const STATUS_LABELS: Record<QueueRowView['status'], string> = {
  OPEN: 'مفتوحة',
  ASSIGNED: 'مسندة',
  DECIDED: 'بانتظار الاعتماد',
  CLOSED: 'مغلقة',
};

const REASON_LABELS: Record<string, string> = {
  CR_NOT_ACTIVE: 'السجل التجاري غير نشط',
  SIGNING_AUTHORITY_UNVERIFIED: 'تعذّر إثبات صلاحية التوقيع',
  ADDRESS_UNAVAILABLE: 'العنوان الوطني غير متوفر',
  CR_STATUS_STALE: 'حالة السجل قديمة',
  NETWORK_SIGNAL: 'إشارة شبكة تستدعي المراجعة',
};

export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code;
}

export function ReviewQueue({ rows }: { rows: QueueRowView[] }): ReactElement {
  const overdue = rows.filter((row) => row.overdue).length;

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="طابور المراجعة"
        subtitle="كل حالة يقرّرها شخص ويعتمدها شخص آخر. لا يجوز أن يكون المقرِّر هو المعتمِد."
        action={
          <button type="submit" className="btn-primary">
            إسناد الحالات إليّ
          </button>
        }
      />

      <Panel
        title="الحالات"
        aside={overdue > 0 ? `${overdue} متأخرة من ${rows.length}` : `${rows.length} حالة`}
      >
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>الكيان</th>
              <th>السبب</th>
              <th>الحالة</th>
              <th>العمر</th>
              <th>المقرِّر</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.caseId} data-overdue={row.overdue ? 'true' : 'false'}>
                <td>
                  <a href={`/entities/${row.entityId}`}>{row.entityName ?? 'بلا اسم'}</a>
                </td>
                <td>{row.reasonCodes.map(reasonLabel).join('، ')}</td>
                <td>
                  {STATUS_LABELS[row.status]}
                  {row.overdue ? (
                    <span
                      className="badge"
                      data-kind="overdue"
                      style={{
                        marginInlineStart: '8px',
                        color: 'var(--changed-fg)',
                        background: 'var(--changed-bg)',
                        borderColor: 'var(--changed-line)',
                      }}
                    >
                      متأخرة
                    </span>
                  ) : null}
                </td>
                <td>
                  <bdi dir="ltr" className="mono">
                    {Math.round(row.ageHours)}
                  </bdi>{' '}
                  ساعة
                </td>
                <td className="muted">{row.decidedBy ?? row.assignedTo ?? 'غير مسندة'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {rows.length === 0 ? (
          <div className="panel-body">
            {/* Good news, and the screen says so rather than showing a blank table. */}
            <EmptyState>لا حالات مفتوحة. لا شيء ينتظر قراراً.</EmptyState>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
