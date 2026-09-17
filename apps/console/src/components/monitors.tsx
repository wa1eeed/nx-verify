import Link from 'next/link';
import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';
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
}: {
  rows: MonitorRowView[];
  outcome?: string | undefined;
  pauseAction?: Action | undefined;
  resumeAction?: Action | undefined;
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

      <p className="card muted" data-role="budget-notice">
        كل مراقبة تُجري تحققاً حقيقياً وتُحاسَب بسعره. السقف لكل فترة: حين ينفد تتوقف المراقبة من
        نفسها ولا تتجاوزه، وتظهر هنا موقوفةً بسببه.
        {spending === 0 ? null : (
          <>
            {' '}
            السقف المجموع لما يعمل الآن{' '}
            <bdi dir="ltr" className="mono">
              {riyals(spending)}
            </bdi>{' '}
            ريال في الفترة.
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
                  <th>الإنفاق من السقف</th>
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
                      ) : (
                        // Nothing to press on an exhausted one: pressing would restart it
                        // and it would stop again on the next sweep. The cap is the control.
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
