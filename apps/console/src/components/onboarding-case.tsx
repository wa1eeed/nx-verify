import Link from 'next/link';
import type { ReactElement } from 'react';
import { PageHeader, Panel } from './page-header';
import { StatusBadge, caseStatusLabel } from './onboarding';
import { SubmitButton } from './ui/submit-button';

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

/**
 * What a firing is called on the screen.
 *
 * A file goes where its journey names, and a journey that names nobody goes where the
 * subscriber's own subscriptions say (ADR-182). The second kind carries one key for every
 * recipient, and printing it raw would read as somebody's action code.
 */
export function actionKeyLabel(actionKey: string): string {
  return actionKey === 'subscription' ? 'اشتراككم في هذا الحدث' : actionKey;
}

/**
 * Whether a decision has been reached on this file.
 *
 * The status, not the verdict. Three of the four ways a file reaches review leave
 * `outcome` null: a required check that failed, a file where every required check was
 * waived, and a ruleset that returned nothing all set the status and no verdict. Reading
 * the verdict here told the owner of such a file «no decision has been taken yet» while
 * their reviewer already had it in a queue and `onboarding.review` had already gone out.
 *
 * This is the same set the dispatcher acts on, which is the point: the sentence about what
 * was fired has to be keyed on the same thing that fires.
 */
export function caseWasDecided(status: string): boolean {
  return status === 'APPROVED' || status === 'REJECTED' || status === 'IN_REVIEW';
}

const OUTCOMES: Record<string, { tone: 'done' | 'refused'; text: string }> = {
  advanced: { tone: 'done', text: 'شُغّلت الفحوص الباقية.' },
  waived: { tone: 'done', text: 'سُجّل تجاوز الفحص بسببه.' },
  number: { tone: 'refused', text: 'اكتب رقم المنشأة لتشغيل ما تبقّى.' },
  closed: { tone: 'refused', text: 'هذا الملف مغلق. لا فحوص تُشغَّل عليه.' },
  failed: { tone: 'refused', text: 'لم يُنفَّذ الإجراء. حاول مرة أخرى.' },
};

export function caseNotice(
  outcome: string | undefined,
): { tone: 'done' | 'refused'; text: string } | null {
  return outcome === undefined ? null : (OUTCOMES[outcome] ?? null);
}

type Action = (formData: FormData) => void | Promise<void>;

export function OnboardingCaseView({
  view,
  outcome,
  advanceAction,
  waiveAction,
}: {
  view: CaseDetailView;
  outcome?: string | undefined;
  /** Absent on a screen that only reports. */
  advanceAction?: Action | undefined;
  waiveAction?: Action | undefined;
}): ReactElement {
  const done = view.steps.filter((step) => step.status !== 'PENDING').length;
  const notice = caseNotice(outcome);
  const open = view.status !== 'CLOSED' && view.steps.some((step) => step.status === 'PENDING');

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title={`ملف ${view.reference}`}
        subtitle={`${view.journeyNameAr} · ${view.entityName ?? 'متقدّم لم يُحَل بعد'}`}
        action={
          view.entityId ? (
            <Link className="btn btn-secondary" href={`/customers/${view.entityId}`}>
              ملف الكيان
            </Link>
          ) : undefined
        }
      />

      {notice === null ? null : (
        <p
          className={`notice notice-${notice.tone}`}
          data-role="case-notice"
          data-tone={notice.tone}
          style={{ margin: 0 }}
        >
          {notice.text}
        </p>
      )}

      {open && advanceAction !== undefined ? (
        <Panel
          title="واصل الفحوص"
          note="الرقم يُطلب في كل مرة ولا يُحفَظ على الملف: المعرّفات لا تُخزَّن صريحة (القاعدة 4)."
        >
          <form
            action={advanceAction}
            className="panel-body row"
            data-role="advance-case"
            style={{ gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <input type="hidden" name="case_id" value={view.caseId} />
            <label className="stack" style={{ gap: 'var(--s-1)' }}>
              <span className="stat-label">الرقم الموحد أو السجل التجاري</span>
              <input
                name="number"
                dir="ltr"
                inputMode="numeric"
                required
                style={{ width: '16ch' }}
              />
            </label>
            <SubmitButton variant="primary" data-role="advance-submit" pendingLabel="جارٍ التشغيل">
              شغّل ما تبقّى
            </SubmitButton>
          </form>
        </Panel>
      ) : null}

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
              مرجعكم:{' '}
              <bdi dir="ltr" className="mono">
                {view.clientRef}
              </bdi>
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
                      <Link href={`/verifications?run=${step.runId}`}>
                        <bdi dir="ltr" className="mono">
                          {step.runReference ?? 'عرض'}
                        </bdi>
                      </Link>
                    ) : step.status === 'PENDING' && waiveAction !== undefined ? (
                      // A waive is not a pass: it records why nobody ran this, from a closed
                      // set of reasons, so the answer reads the same on every screen.
                      <form
                        action={waiveAction}
                        className="row"
                        data-role="waive-step"
                        style={{ gap: 'var(--s-2)', alignItems: 'flex-end' }}
                      >
                        <input type="hidden" name="case_id" value={view.caseId} />
                        <input type="hidden" name="step_key" value={step.stepKey} />
                        <select
                          name="reason"
                          defaultValue="NOT_APPLICABLE"
                          aria-label={`سبب تجاوز ${step.productNameAr}`}
                          style={{ width: 'auto' }}
                        >
                          {Object.entries(WAIVE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <SubmitButton
                          variant="ghost"
                          data-role="waive-submit"
                          pendingLabel="جارٍ التسجيل"
                        >
                          تجاوز
                        </SubmitButton>
                      </form>
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
          /*
            Where a destination comes from, said as it is.

            This used to read «لا إجراءات معرّفة لهذه الرحلة», which reads like a setting
            somebody left empty, and there was no screen anywhere that set it: the table it
            spoke of is written by nothing but provisioning. What a subscriber actually
            controls is the subscription, on the two screens named here, and a decision now
            goes there (ADR-182). So the sentence points at the door that exists.

            Which of the three sentences is right is read off the status. The verdict is
            null on a file a failed check sent to a person, and keying on it said «no
            decision yet» about a file that had been decided, announced, and put in front
            of a reviewer.
          */
          <p className="panel-body muted" data-role="no-actions">
            {view.status === 'WITHDRAWN' ? (
              'سُحب هذا الملف قبل أن يُقرَّر، فلم يُطلق شيء.'
            ) : !caseWasDecided(view.status) ? (
              'لم يُتخذ قرار بعد، فلم يُطلق شيء.'
            ) : (
              <>
                صدر القرار ولم يُطلق هذا الملف شيئاً: لم تكن لهذا الحدث وجهة لحظة القرار. هذا ليس
                عطلاً. الوجهات عندكم: أنظمتكم من{' '}
                <Link href="/settings/developers/webhooks">إعدادات Webhooks</Link>، وفريقكم من{' '}
                <Link href="/settings/notifications">إعدادات التنبيهات</Link>.
              </>
            )}
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
                {view.actions.map((action, index) => (
                  // A decision fires everything it fires in one transaction, so the rows
                  // share a timestamp and several can share a key. The position is what
                  // separates them.
                  <tr key={`${action.actionKey}-${index}`} data-role="case-action">
                    <td>{actionKeyLabel(action.actionKey)}</td>
                    <td>{action.actionType === 'WEBHOOK' ? 'نداء نظامكم' : 'تنبيه'}</td>
                    <td>{caseStatusLabel(action.outcome)}</td>
                    <td>
                      {action.delivered ? (
                        <span
                          className="badge"
                          style={{ borderColor: 'var(--fresh-line)', color: 'var(--fresh-fg)' }}
                        >
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
