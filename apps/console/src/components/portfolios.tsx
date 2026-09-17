import type { ReactElement } from 'react';
import { EmptyState, PageHeader, Panel } from './page-header';
import { SubmitButton } from './ui/submit-button';

/**
 * Portfolios.
 *
 * The columns are the policy, because that is what a portfolio is. Showing the retention
 * override and the monitoring budget on the list is what stops a portfolio from quietly
 * becoming a folder: the operator sees, at a glance, what belonging to it costs and what
 * it enforces.
 *
 * And it can be made from here (ADR-147). «محفظة جديدة» was a submit button with no form
 * around it, so the screen promised per-group durations, rules and monitoring and offered no
 * way to have a group at all. The form asks for the policy at the moment the group is made,
 * because a shell nobody comes back to configure is the folder this screen exists to prevent.
 */

export interface PortfolioRowView {
  portfolioId: string;
  code: string;
  nameAr: string;
  entities: number;
  withExpired: number;
  openCases: number;
  monitorByDefault: boolean;
  monitorBudget: number | null;
  decisionRuleset: string | null;
}

const OUTCOMES: Record<string, { tone: 'done' | 'refused'; text: string }> = {
  created: { tone: 'done', text: 'أُنشئت المجموعة.' },
  ttl: { tone: 'done', text: 'حُفظت المدة لهذه المجموعة.' },
  invalid: {
    tone: 'refused',
    text: 'لم تُنشأ: الرمز حروف وأرقام من حرفين إلى أربعين، والاسم إلزامي.',
  },
  exists: { tone: 'refused', text: 'يوجد مجموعة بالرمز نفسه.' },
  budget: {
    tone: 'refused',
    text: 'المراقبة التلقائية تحتاج سقف إنفاق. مراقبة بلا سقف تستهلك رصيدك بهدوء.',
  },
  failed: { tone: 'refused', text: 'لم يُحفظ التغيير. حاول مرة أخرى.' },
};

export function portfolioNotice(
  outcome: string | undefined,
): { tone: 'done' | 'refused'; text: string } | null {
  return outcome === undefined ? null : (OUTCOMES[outcome] ?? null);
}

export function Portfolios({
  rows,
  outcome,
  createAction,
}: {
  rows: PortfolioRowView[];
  outcome?: string | undefined;
  /** Absent on a screen that only reports. */
  createAction?: ((formData: FormData) => void | Promise<void>) | undefined;
}): ReactElement {
  const notice = portfolioNotice(outcome);
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="المجموعات"
        subtitle="جمّع عملاءك حسب الغرض، واضبط لكل مجموعة مدد صلاحيتها وقواعد قرارها ومراقبتها."
      />

      {notice === null ? null : (
        <p
          className={`notice notice-${notice.tone}`}
          data-role="portfolio-outcome"
          data-tone={notice.tone}
          style={{ margin: 0 }}
        >
          {notice.text}
        </p>
      )}

      {createAction === undefined ? null : (
        <Panel
          title="مجموعة جديدة"
          note="المجموعة ليست مجلداً: تحمل سياسة. ما يُتحقق به العضو الجديد، وهل يُراقَب وبأي سقف."
        >
          <form
            action={createAction}
            className="panel-body stack"
            data-role="create-portfolio"
            style={{ gap: 'var(--s-3)' }}
          >
            <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
              <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '180px' }}>
                <span className="stat-label">الاسم</span>
                <input name="name_ar" required placeholder="موردو القطاع الحكومي" />
              </label>
              <label className="stack" style={{ gap: 'var(--s-1)', minWidth: '150px' }}>
                <span className="stat-label">الرمز</span>
                <input name="code" dir="ltr" required placeholder="GOV_SUPPLIERS" />
              </label>
            </div>
            <div className="row" style={{ gap: 'var(--s-4)', flexWrap: 'wrap' }}>
              <label className="row" style={{ gap: 'var(--s-2)' }}>
                <input type="checkbox" name="monitor_by_default" />
                <span>راقب أعضاءها تلقائياً</span>
              </label>
              <label className="row" style={{ gap: 'var(--s-2)' }}>
                <input type="checkbox" name="alert_on_enter" />
                <span>نبّهني عند دخول عميل إليها</span>
              </label>
            </div>
            <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
              <label className="stack" style={{ gap: 'var(--s-1)' }}>
                <span className="stat-label">وتيرة المراقبة</span>
                <select name="monitor_cadence" defaultValue="MONTHLY" style={{ width: 'auto' }}>
                  <option value="ON_EXPIRY">عند انتهاء الصلاحية</option>
                  <option value="MONTHLY">شهرياً</option>
                  <option value="WEEKLY">أسبوعياً</option>
                  <option value="DAILY">يومياً</option>
                </select>
              </label>
              <label className="stack" style={{ gap: 'var(--s-1)' }}>
                <span className="stat-label">سقف الإنفاق بالريال</span>
                <input
                  name="monitor_budget"
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="500"
                  style={{ width: '10ch' }}
                />
              </label>
            </div>
            <div>
              <SubmitButton
                variant="primary"
                data-role="create-portfolio-submit"
                pendingLabel="جارٍ الإنشاء"
              >
                أنشئ المجموعة
              </SubmitButton>
            </div>
          </form>
        </Panel>
      )}

      <Panel
        title="المحافظ القائمة"
        aside={`${rows.length} محفظة`}
        note="الكيان قد ينتمي لأكثر من مجموعة. عند تعارض مجموعتين تفوز المدة الأقصر."
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>المحفظة</th>
                <th>السجلات</th>
                <th>منتهية الصلاحية</th>
                <th>حالات مفتوحة</th>
                <th>المراقبة</th>
                <th>قواعد القرار</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.portfolioId}>
                  <td>{row.nameAr}</td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {row.entities}
                    </bdi>
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {row.withExpired}
                    </bdi>
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {row.openCases}
                    </bdi>
                  </td>
                  <td className="muted">
                    {row.monitorByDefault ? (
                      <span data-role="monitoring">
                        مفعّلة بسقف{' '}
                        <bdi dir="ltr" className="mono">
                          {((row.monitorBudget ?? 0) / 100).toFixed(2)}
                        </bdi>{' '}
                        ريال
                      </span>
                    ) : (
                      'غير مفعّلة'
                    )}
                  </td>
                  <td className="muted">
                    {row.decisionRuleset ? 'خاصة بالمحفظة' : 'قواعد المنتج'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا محافظ بعد. المحفظة هي المكان الذي تُضبط فيه السياسة.</EmptyState>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
