import Link from 'next/link';
import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';
import { Input } from './ui/input';
import { SubmitButton } from './ui/submit-button';
import { fieldLabel } from './field-card';
import { isoDate, riyals } from './format';

/**
 * What this workspace is watching, and what it costs (ADR-152).
 *
 * `pauseMonitor` had no caller anywhere and there was no monitors screen at all, so a
 * monitor, once started, kept spending until it hit its ceiling and nothing could stop it.
 * Money leaving with no stop is the one kind of dead control that gets expensive rather than
 * merely annoying.
 *
 * Paused and exhausted monitors are listed too. One that stopped because its budget ran out
 * is exactly the row somebody needs: it is why a customer quietly stopped being watched, and
 * it is invisible if the list shows only what is running.
 */

export interface MonitorRowView {
  id: string;
  entityId: string;
  entityName: string | null;
  productNameAr: string;
  fieldPaths: string[];
  cadence: string;
  nextRunAt: Date;
  budgetCap: number;
  spentThisPeriod: number;
  status: 'active' | 'paused' | 'budget_exhausted';
}

const CADENCE_LABELS: Record<string, string> = {
  DAILY: 'يومياً',
  WEEKLY: 'أسبوعياً',
  MONTHLY: 'شهرياً',
  ON_EXPIRY: 'عند انتهاء الصلاحية',
};

const STATUS_LABELS: Record<MonitorRowView['status'], string> = {
  active: 'تعمل',
  paused: 'موقوفة',
  budget_exhausted: 'توقفت: نفد سقف الفترة',
};

const OUTCOMES: Record<string, { tone: 'done' | 'refused'; text: string }> = {
  paused: { tone: 'done', text: 'أُوقفت المراقبة. لا تنفق شيئاً حتى تشغّلها.' },
  resumed: { tone: 'done', text: 'عادت المراقبة، وتفحص أول مرة الآن.' },
  exhausted: {
    tone: 'refused',
    text: 'هذه توقفت لنفاد سقفها لا بإيقاف. ارفع السقف وتعود وحدها.',
  },
  raised: { tone: 'done', text: 'رُفع السقف وعادت المراقبة وحدها، وتفحص أول مرة الآن.' },
  cap_too_low: {
    tone: 'refused',
    text: 'السقف الجديد لا يتجاوز ما أُنفق في هذا الشهر، فبقيت المراقبة متوقفة. اكتب رقماً أعلى.',
  },
  cap_changed: { tone: 'done', text: 'حُفظ السقف الجديد.' },
  failed: { tone: 'refused', text: 'لم يُنفَّذ الإجراء. حاول مرة أخرى.' },
};

export function monitorNotice(
  outcome: string | undefined,
): { tone: 'done' | 'refused'; text: string } | null {
  return outcome === undefined ? null : (OUTCOMES[outcome] ?? null);
}

export function cadenceLabel(cadence: string): string {
  return CADENCE_LABELS[cadence] ?? cadence;
}

type Action = (formData: FormData) => void | Promise<void>;

export function Monitors({
  rows,
  outcome,
  pauseAction,
  resumeAction,
  raiseBudgetAction,
}: {
  rows: MonitorRowView[];
  outcome?: string | undefined;
  pauseAction?: Action | undefined;
  resumeAction?: Action | undefined;
  raiseBudgetAction?: Action | undefined;
}): ReactElement {
  const notice = monitorNotice(outcome);
  const spending = rows
    .filter((row) => row.status === 'active')
    .reduce((total, row) => total + row.budgetCap, 0);

  return (
    <section className="stack" data-role="monitors" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="المراقبة"
        subtitle="من تتابعه المنصة نيابة عنك، وبأي وتيرة، وبأي سقف إنفاق."
      />

      {notice === null ? null : (
        <p
          className={`notice notice-${notice.tone}`}
          data-role="monitor-outcome"
          data-tone={notice.tone}
          style={{ margin: 0 }}
        >
          {notice.text}
        </p>
      )}

      {/*
        The period had no name on this screen, and «الفترة» is not one: the sweep measures
        spending against the calendar month and zeroes it on the first of the next one, and
        it does that only for monitors that are still running, so a stopped one does not
        come back with the new month. A subscriber waiting for the first of the month to get
        their monitoring back waits forever.
      */}
      <p className="card muted" data-role="budget-notice">
        كل مراقبة تُجري تحققاً حقيقياً وتُحاسَب بسعره. السقف لشهر ميلادي واحد: ما أُنفق يعود إلى
        الصفر مع أول الشهر التالي ما دامت المراقبة تعمل. وقبل كل فحص تتأكد المنصة أن المتبقي يغطي
        سعر التحقق كاملاً، وإلا توقفت ولم تتجاوز السقف. والتي توقفت لنفاد سقفها لا تعود مع الشهر
        الجديد وحدها: ارفع سقفها هنا لتعود.
        {spending === 0 ? null : (
          <>
            {' '}
            السقف المجموع لما يعمل الآن{' '}
            <bdi dir="ltr" className="mono">
              {riyals(spending)}
            </bdi>{' '}
            ريال في الشهر.
          </>
        )}
      </p>

      {rows.length === 0 ? (
        <EmptyState>لا مراقبات. تُفعّل من ملف العميل، أو من مجموعة تراقب أعضاءها.</EmptyState>
      ) : (
        <Panel title="المراقبات" aside={`${rows.length}`}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>العميل</th>
                  <th>ما يُتابَع</th>
                  <th>الوتيرة</th>
                  <th>الإنفاق من سقف الشهر</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-role="monitor-row" data-status={row.status}>
                    <td>
                      <Link prefetch={false} href={`/customers/${row.entityId}`}>
                        {row.entityName ?? 'بلا اسم'}
                      </Link>
                    </td>
                    <td>
                      {row.productNameAr}
                      <div className="faint">
                        {row.fieldPaths.map((path) => fieldLabel(path)).join('، ')}
                      </div>
                    </td>
                    <td>
                      {cadenceLabel(row.cadence)}
                      <div className="faint">
                        التالي{' '}
                        <bdi dir="ltr" className="mono">
                          {isoDate(row.nextRunAt)}
                        </bdi>
                      </div>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {riyals(row.spentThisPeriod)}
                      </bdi>{' '}
                      من{' '}
                      <bdi dir="ltr" className="mono">
                        {riyals(row.budgetCap)}
                      </bdi>
                    </td>
                    <td>
                      <span className="badge" data-status={row.status}>
                        {STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td>
                      {row.status === 'active' && pauseAction !== undefined ? (
                        <form action={pauseAction}>
                          <input type="hidden" name="monitor_id" value={row.id} />
                          <SubmitButton
                            variant="ghost"
                            data-role="pause-monitor"
                            pendingLabel="جارٍ الإيقاف"
                          >
                            أوقف
                          </SubmitButton>
                        </form>
                      ) : row.status === 'paused' && resumeAction !== undefined ? (
                        <form action={resumeAction}>
                          <input type="hidden" name="monitor_id" value={row.id} />
                          <SubmitButton
                            variant="ghost"
                            data-role="resume-monitor"
                            pendingLabel="جارٍ التشغيل"
                          >
                            شغّل
                          </SubmitButton>
                        </form>
                      ) : row.status === 'budget_exhausted' && raiseBudgetAction !== undefined ? (
                        // The cap is the control, and until now it was a sentence: this cell
                        // said «ارفع السقف» and no screen in the platform could raise one, so
                        // a monitor that reached its ceiling was watched by nobody for good.
                        <form
                          action={raiseBudgetAction}
                          className="row"
                          style={{ gap: 'var(--s-2)', flexWrap: 'wrap' }}
                        >
                          <input type="hidden" name="monitor_id" value={row.id} />
                          <Input
                            name="budget_cap"
                            id={`budget-cap-${row.id}`}
                            aria-label="سقف الشهر بالريال"
                            // Plain digits and a dot: the grouped form a person reads carries
                            // a comma, and a comma is not a number when it is posted back.
                            defaultValue={(row.budgetCap / 100).toFixed(2)}
                            inputMode="decimal"
                            size={7}
                            required
                            ltr
                          />
                          <SubmitButton
                            variant="ghost"
                            data-role="raise-monitor-budget"
                            pendingLabel="جارٍ الرفع"
                          >
                            ارفع السقف
                          </SubmitButton>
                        </form>
                      ) : (
                        // Read only: a caller that passes no action, such as a rendering of
                        // this table for somebody who may not manage monitoring.
                        <span className="faint">ارفع السقف</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </section>
  );
}
