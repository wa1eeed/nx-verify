import type { ReactElement } from 'react';
import { PageHeader, Panel } from './page-header';
import { StatusBadge, caseStatusLabel } from './onboarding';

/**
 * One file, and everything that was done to it.
 *
 * The order answers the questions in the order they are asked: what did this decide, what
 * was checked, what did somebody decide not to check and why, and what did the decision
 * set off. The last of those is the part a customer asks about during an incident, and a
 * screen that cannot answer it sends them to us instead of to their own logs.
 */

export interface CaseStepView {
  stepKey: string;
  productNameAr: string;
  required: boolean;
  status: string;
  runId: string | null;
  runReference: string | null;
  waiveReason: string | null;
  decidedAt: Date | null;
}

export interface CaseActionView {
  actionKey: string;
  actionType: string;
  outcome: string;
  delivered: boolean;
  at: Date;
}

export interface CaseDetailView {
  caseId: string;
  reference: string;
  journeyNameAr: string;
  entityId: string | null;
  entityName: string | null;
  status: string;
  outcome: string | null;
  clientRef: string | null;
  openedAt: Date;
  dueAt: Date;
  closedAt: Date | null;
  overdue: boolean;
  steps: CaseStepView[];
  actions: CaseActionView[];
}

const STEP_LABELS: Record<string, string> = {
  PENDING: 'معلّقة',
  DONE: 'تمت',
  FAILED: 'تعذّرت',
  WAIVED: 'مُتنازَل عنها',
  NOT_APPLICABLE: 'لا تنطبق',
};

const WAIVE_LABELS: Record<string, string> = {
  ALREADY_VERIFIED_ELSEWHERE: 'تحقق سابق خارج المنصة',
  NOT_APPLICABLE: 'لا تنطبق على هذا المتقدّم',
  DOCUMENT_ON_FILE: 'مستند محفوظ لدى العميل',
  RISK_ACCEPTED: 'مخاطرة مقبولة',
};

export function stepStatusLabel(status: string): string {
  return STEP_LABELS[status] ?? status;
}

export function waiveReasonLabel(reason: string): string {
  return WAIVE_LABELS[reason] ?? reason;
}

export function OnboardingCaseView({ view }: { view: CaseDetailView }): ReactElement {
  const done = view.steps.filter((step) => step.status !== 'PENDING').length;

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title={`ملف ${view.reference}`}
        subtitle={`${view.journeyNameAr} · ${view.entityName ?? 'متقدّم لم يُحَل بعد'}`}
        action={
          view.entityId ? (
            <a className="btn-secondary" href={`/entities/${view.entityId}`}>
              ملف الكيان
            </a>
          ) : undefined
        }
      />

      <section className="grid" data-role="case-indicators">
        <article className="stat">
          <span className="stat-label">الحالة</span>
          <div style={{ marginBlockStart: 'var(--s-1)' }}>
            <StatusBadge status={view.status} />
          </div>
          {view.outcome ? <span className="stat-hint">القرار: {view.outcome}</span> : null}
        </article>
        <article className="stat">
          <span className="stat-label">التقدّم</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {done}/{view.steps.length}
            </bdi>
          </strong>
        </article>
        <article className="stat" {...(view.overdue ? { 'data-tone': 'critical' } : {})}>
          <span className="stat-label">المهلة</span>
          <strong className="stat-value" style={{ fontSize: '18px' }}>
            <bdi dir="ltr" className="mono">
              {view.dueAt.toISOString().slice(0, 10)}
            </bdi>
          </strong>
          {view.overdue ? <span className="stat-hint">تجاوز المهلة</span> : null}
        </article>
        <article className="stat">
          <span className="stat-label">فُتح</span>
          <strong className="stat-value" style={{ fontSize: '18px' }}>
            <bdi dir="ltr" className="mono">
              {view.openedAt.toISOString().slice(0, 10)}
            </bdi>
          </strong>
          {view.clientRef ? (
            <span className="stat-hint">
              مرجعكم: <bdi dir="ltr" className="mono">{view.clientRef}</bdi>
            </span>
          ) : null}
        </article>
      </section>

      <Panel title="الفحوص" aside={`${view.steps.length} فحصاً`} role="case-steps">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الفحص</th>
                <th>إلزامي</th>
                <th>الحالة</th>
                <th>التحقق</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {view.steps.map((step) => (
                <tr key={step.stepKey} data-role="case-step" data-status={step.status}>
                  <td>{step.productNameAr}</td>
                  <td>{step.required ? 'نعم' : 'لا'}</td>
                  <td>
                    {stepStatusLabel(step.status)}
                    {step.waiveReason ? (
                      // Why it was waived, from the closed set the platform allows, so
                      // the answer is the same on every screen and in every report.
                      <div className="muted" data-role="waive-reason">
                        {waiveReasonLabel(step.waiveReason)}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {step.runId ? (
                      <a href={`/registry?run=${step.runId}`}>
                        <bdi dir="ltr" className="mono">
                          {step.runReference ?? 'عرض'}
                        </bdi>
                      </a>
                    ) : (
                      <span className="muted">لا يوجد</span>
                    )}
                  </td>
                  <td>
                    {step.decidedAt ? (
                      <bdi dir="ltr" className="mono">
                        {step.decidedAt.toISOString().slice(0, 10)}
                      </bdi>
                    ) : (
                      <span className="muted">لم يُحسم بعد</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="ما أطلقه القرار" aside="إلى أنظمتكم وإلى فريقكم" role="case-actions">
        {view.actions.length === 0 ? (
          <p className="panel-body muted" data-role="no-actions">
            {view.outcome === null
              ? 'لم يُتخذ قرار بعد، فلم يُطلق شيء.'
              : 'لا إجراءات معرّفة لهذه الرحلة، فلم يُطلق شيء. هذا ليس عطلاً.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الإجراء</th>
                  <th>النوع</th>
                  <th>عند</th>
                  <th>التسليم</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {view.actions.map((action) => (
                  <tr key={`${action.actionKey}-${action.at.toISOString()}`} data-role="case-action">
                    <td>{action.actionKey}</td>
                    <td>{action.actionType === 'WEBHOOK' ? 'نداء نظامكم' : 'تنبيه'}</td>
                    <td>{caseStatusLabel(action.outcome)}</td>
                    <td>
                      {action.delivered ? (
                        <span className="badge" style={{ borderColor: 'var(--fresh-line)', color: 'var(--fresh-fg)' }}>
                          في طابور التسليم
                        </span>
                      ) : (
                        <span className="badge" data-role="not-delivered">
                          لم يُسلَّم، الهدف معطّل
                        </span>
                      )}
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {action.at.toISOString().slice(0, 10)}
                      </bdi>
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
