import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';

/**
 * The files in flight.
 *
 * A compliance team opens this screen to answer one question: what is waiting on us. So
 * the open files come first, sorted by their clock, and a late one says so where the eye
 * already is rather than in a column at the end.
 *
 * Colour is spent carefully here. Approved and rejected are outcomes and carry the fresh
 * and critical palettes; a file waiting for a person carries neither, because the warning
 * colour belongs to a detected change and nothing else, and spending it on "somebody
 * should look at this" would make the two indistinguishable at a glance.
 */

export interface CaseRowView {
  caseId: string;
  reference: string;
  journeyNameAr: string;
  entityName: string | null;
  status: string;
  outcome: string | null;
  done: number;
  total: number;
  dueAt: Date;
  overdue: boolean;
}

export const CASE_STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: 'قيد التنفيذ',
  AWAITING_INPUT: 'بانتظار المتقدّم',
  IN_REVIEW: 'بانتظار مراجعة',
  APPROVED: 'مقبول',
  REJECTED: 'مرفوض',
  WITHDRAWN: 'مسحوب',
};

export function caseStatusLabel(status: string): string {
  return CASE_STATUS_LABELS[status] ?? status;
}

export function StatusBadge({ status }: { status: string }): ReactElement {
  const style =
    status === 'APPROVED'
      ? { borderColor: 'var(--fresh-line)', color: 'var(--fresh-fg)', background: 'var(--fresh-bg)' }
      : status === 'REJECTED'
        ? {
            borderColor: 'var(--critical-line)',
            color: 'var(--critical-fg)',
            background: 'var(--critical-bg)',
          }
        : { borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' };

  return (
    <span className="badge" data-role="case-status" data-status={status} style={style}>
      {caseStatusLabel(status)}
    </span>
  );
}

export function OnboardingList({ cases }: { cases: CaseRowView[] }): ReactElement {
  const open = cases.filter((row) => row.outcome === null || row.status === 'IN_REVIEW');
  const late = open.filter((row) => row.overdue);

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="ملفات التأهيل"
        subtitle="كل ملف يجمع ما فُحص عن متقدّم، وما تُنوزل عنه، وما قرره في النهاية."
        action={
          <a className="btn-primary" href="/onboarding/new">
            فتح ملف
          </a>
        }
      />

      <section className="grid" data-role="onboarding-tiles">
        <article className="stat">
          <span className="stat-label">ملفات مفتوحة</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {open.length}
            </bdi>
          </strong>
        </article>
        <article className="stat" {...(late.length > 0 ? { 'data-tone': 'critical' } : {})}>
          <span className="stat-label">تجاوزت مهلتها</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {late.length}
            </bdi>
          </strong>
          <span className="stat-hint">المهلة من رحلة التأهيل</span>
        </article>
        <article className="stat">
          <span className="stat-label">مقبولة</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {cases.filter((row) => row.status === 'APPROVED').length}
            </bdi>
          </strong>
        </article>
      </section>

      <Panel title="الملفات" aside={`${cases.length} ملفاً`}>
        {cases.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا ملفات تأهيل بعد. أول ملف يبدأ برحلة معرّفة في الإعدادات.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>المرجع</th>
                  <th>الرحلة</th>
                  <th>المتقدّم</th>
                  <th>الحالة</th>
                  <th>التقدّم</th>
                  <th>المهلة</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((row) => (
                  <tr key={row.caseId} data-role="case-row" data-overdue={row.overdue ? 'true' : 'false'}>
                    <td>
                      <a href={`/onboarding/${row.caseId}`}>
                        <bdi dir="ltr" className="mono">
                          {row.reference}
                        </bdi>
                      </a>
                    </td>
                    <td>{row.journeyNameAr}</td>
                    <td>{row.entityName ?? <span className="muted">لم يُحَل بعد</span>}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {row.done}/{row.total}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {row.dueAt.toISOString().slice(0, 10)}
                      </bdi>
                      {row.overdue ? (
                        <span
                          className="badge"
                          data-role="overdue"
                          style={{
                            borderColor: 'var(--critical-line)',
                            color: 'var(--critical-fg)',
                            marginInlineStart: 'var(--s-2)',
                          }}
                        >
                          متأخر
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
