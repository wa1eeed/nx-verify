import type { ReactElement } from 'react';
import { fieldLabel } from './field-card';
import { EmptyState, PageHeader, Panel } from './page-header';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { SubmitButton } from './ui/submit-button';

/**
 * Groups («المجموعات»).
 *
 * The columns are the policy, because that is what a group is. Showing the product its
 * members are checked with, the monitoring ceiling and the ruleset that decides them is
 * what stops a group from quietly becoming a folder.
 *
 * Four things on this screen were saved and did nothing, and each is fixed here rather
 * than described more carefully:
 *
 *   «راقب أعضاءها تلقائياً» took a cadence and a ceiling and never started a monitor,
 *   because a monitor repeats one product and the form never asked which. The product is
 *   asked for now, and the action refuses the pair rather than accepting a setting it
 *   cannot honour.
 *
 *   «نبّهني عند دخول عميل إليها» wrote a column that no query in the platform reads. It
 *   is gone. A promise nothing keeps costs more than the missing feature.
 *
 *   «قواعد القرار» could only ever print «قواعد المنتج», because nothing could give a
 *   group a ruleset, which also left every fork made on the rules screen unreachable: a
 *   fork only takes effect through a group. The create form offers them now.
 *
 *   The header promised durations, rules and monitoring «لكل مجموعة» and offered no way to
 *   change any of them. Durations are editable here, and the header no longer claims the
 *   other two are: they are set when the group is made, and it says so.
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
  /** Absent on a caller that has not read it; the cell then says so rather than guessing. */
  monitorCadence?: string | null | undefined;
  defaultProductCode?: string | null | undefined;
}

/** A product a member can be checked with, named as the subscriber reads it. */
export interface ProductOptionView {
  code: string;
  nameAr: string;
}

/** A ruleset this workspace may decide by, including the forks made on the rules screen. */
export interface RulesetOptionView {
  id: string;
  nameAr: string;
}

/** A duration one group keeps for one field, shorter or longer than the workspace default. */
export interface PortfolioTtlView {
  portfolioId: string;
  fieldPath: string;
  ttlDays: number;
  weight: number;
}

const CADENCE_AR: Record<string, string> = {
  ON_EXPIRY: 'عند انتهاء الصلاحية',
  MONTHLY: 'شهرياً',
  WEEKLY: 'أسبوعياً',
  DAILY: 'يومياً',
};

/** «مفعّلة أسبوعياً بسقف», or without the cadence when the caller did not read one. */
function monitoringLead(cadence: string | null | undefined): string {
  const when = cadence === null || cadence === undefined ? undefined : CADENCE_AR[cadence];
  return when === undefined ? 'مفعّلة بسقف ' : `مفعّلة ${when} بسقف `;
}

const OUTCOMES: Record<string, { tone: 'done' | 'refused'; text: string }> = {
  created: { tone: 'done', text: 'أُنشئت المجموعة.' },
  ttl: { tone: 'done', text: 'حُفظت المدة لهذه المجموعة.' },
  invalid: {
    tone: 'refused',
    text: 'لم تُنشأ: الرمز حروف وأرقام من حرفين إلى أربعين، والاسم إلزامي.',
  },
  ttl_invalid: {
    tone: 'refused',
    text: 'لم تُحفظ المدة: المدة يوم فأكثر، والوزن من 0 إلى 100.',
  },
  exists: { tone: 'refused', text: 'يوجد مجموعة بالرمز نفسه.' },
  budget: {
    tone: 'refused',
    text: 'المراقبة التلقائية تحتاج سقف إنفاق. مراقبة بلا سقف تستهلك رصيدك بهدوء.',
  },
  product: {
    tone: 'refused',
    text: 'المراقبة التلقائية تحتاج منتجاً يُعاد به التحقق. اختر منتج الأعضاء أو أوقف المراقبة.',
  },
  failed: { tone: 'refused', text: 'لم يُحفظ التغيير. حاول مرة أخرى.' },
};

export function portfolioNotice(
  outcome: string | undefined,
): { tone: 'done' | 'refused'; text: string } | null {
  return outcome === undefined ? null : (OUTCOMES[outcome] ?? null);
}

type Action = (formData: FormData) => void | Promise<void>;

export function Portfolios({
  rows,
  outcome,
  products = [],
  rulesets = [],
  fieldPaths = [],
  ttls = [],
  createAction,
  setTtlAction,
}: {
  rows: PortfolioRowView[];
  outcome?: string | undefined;
  /** What a member can be checked with. Empty means monitoring cannot be offered at all. */
  products?: readonly ProductOptionView[] | undefined;
  rulesets?: readonly RulesetOptionView[] | undefined;
  /** The fields a duration can be set for, the same vocabulary as the retention screen. */
  fieldPaths?: readonly string[] | undefined;
  ttls?: readonly PortfolioTtlView[] | undefined;
  /** Absent on a screen that only reports. */
  createAction?: Action | undefined;
  setTtlAction?: Action | undefined;
}): ReactElement {
  const notice = portfolioNotice(outcome);
  const productName = new Map(products.map((product) => [product.code, product.nameAr]));
  const rulesetName = new Map(rulesets.map((ruleset) => [ruleset.id, ruleset.nameAr]));
  const groupName = new Map(rows.map((row) => [row.portfolioId, row.nameAr]));
  const canSetTtl = setTtlAction !== undefined && rows.length > 0 && fieldPaths.length > 0;

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="المجموعات"
        subtitle="جمّع عملاءك حسب الغرض. قواعد القرار والمراقبة تُضبط عند إنشاء المجموعة، ومدد الصلاحية تُعدَّل لها في أي وقت."
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
          note="المجموعة ليست مجلداً: تحمل سياسة. ما يُتحقق به العضو الجديد، وبأي قواعد يُقرَّر، وهل يُراقَب وبأي سقف."
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
                <Input name="name_ar" required placeholder="موردو القطاع الحكومي" />
              </label>
              <label className="stack" style={{ gap: 'var(--s-1)', minWidth: '150px' }}>
                <span className="stat-label">الرمز</span>
                <Input name="code" ltr required placeholder="GOV_SUPPLIERS" />
              </label>
            </div>
            <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
              <label className="stack" style={{ gap: 'var(--s-1)', minWidth: '200px' }}>
                <span className="stat-label">منتج الأعضاء</span>
                <Select name="default_product" defaultValue="">
                  <option value="">بلا منتج محدد</option>
                  {products.map((product) => (
                    <option key={product.code} value={product.code}>
                      {product.nameAr}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="stack" style={{ gap: 'var(--s-1)', minWidth: '200px' }}>
                <span className="stat-label">قواعد القرار</span>
                {/* The fork made on the rules screen reaches real decisions through here and
                    through nowhere else. With no way to name it, every fork was decoration. */}
                <Select name="decision_ruleset" defaultValue="">
                  <option value="">قواعد المنتج</option>
                  {rulesets.map((ruleset) => (
                    <option key={ruleset.id} value={ruleset.id}>
                      {ruleset.nameAr}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="stack" style={{ gap: 'var(--s-1)' }}>
              <Checkbox name="monitor_by_default" disabled={products.length === 0}>
                راقب أعضاءها تلقائياً
              </Checkbox>
              <p className="faint" style={{ margin: 0 }} data-role="monitoring-needs">
                {products.length === 0
                  ? 'لا مراقبة تلقائية قبل أن يكون في مساحتك منتج يُعاد به التحقق.'
                  : 'المراقبة تحتاج منتج الأعضاء ووتيرة وسقف إنفاق. بلا منتج لا يُراقَب أحد.'}
              </p>
            </div>
            <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
              <label className="stack" style={{ gap: 'var(--s-1)' }}>
                <span className="stat-label">وتيرة المراقبة</span>
                <Select name="monitor_cadence" defaultValue="MONTHLY">
                  <option value="ON_EXPIRY">عند انتهاء الصلاحية</option>
                  <option value="MONTHLY">شهرياً</option>
                  <option value="WEEKLY">أسبوعياً</option>
                  <option value="DAILY">يومياً</option>
                </Select>
              </label>
              <label className="stack" style={{ gap: 'var(--s-1)' }}>
                <span className="stat-label">سقف الإنفاق بالريال</span>
                <Input name="monitor_budget" ltr inputMode="decimal" placeholder="500" size={8} />
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
        title="المجموعات القائمة"
        aside={`${rows.length} مجموعة`}
        note="الكيان قد ينتمي لأكثر من مجموعة. عند تعارض مجموعتين تفوز المدة الأقصر."
      >
        {/* Nothing to list reads before the table, not after it. The empty line used to sit
            below a full set of headers, so an empty screen showed a table and then said
            there was nothing in it. */}
        {rows.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا مجموعات بعد. المجموعة هي المكان الذي تُضبط فيه السياسة.</EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>المجموعة</th>
                  <th>السجلات</th>
                  <th>منتهية الصلاحية</th>
                  <th>حالات مفتوحة</th>
                  <th>منتج الأعضاء</th>
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
                      {row.defaultProductCode
                        ? (productName.get(row.defaultProductCode) ?? row.defaultProductCode)
                        : 'بلا منتج محدد'}
                    </td>
                    <td className="muted">
                      {row.monitorByDefault ? (
                        <span data-role="monitoring">
                          {monitoringLead(row.monitorCadence)}
                          <bdi dir="ltr" className="mono">
                            {((row.monitorBudget ?? 0) / 100).toFixed(2)}
                          </bdi>
                          {' ريال'}
                        </span>
                      ) : (
                        'غير مفعّلة'
                      )}
                    </td>
                    <td className="muted">
                      {row.decisionRuleset === null
                        ? 'قواعد المنتج'
                        : (rulesetName.get(row.decisionRuleset) ?? 'قواعد خاصة بالمجموعة')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {canSetTtl ? (
        <Panel
          title="مدد الصلاحية لمجموعة"
          note="مدة المجموعة تسبق مدة المشترك، وتعديلها لا يغيّر أي إفادة: تُعاد الحسابات فقط."
        >
          <form
            action={setTtlAction}
            className="panel-body stack"
            data-role="portfolio-ttl"
            style={{ gap: 'var(--s-3)' }}
          >
            <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
              <label className="stack" style={{ gap: 'var(--s-1)', minWidth: '180px' }}>
                <span className="stat-label">المجموعة</span>
                <Select name="portfolio_id" defaultValue={rows[0]?.portfolioId}>
                  {rows.map((row) => (
                    <option key={row.portfolioId} value={row.portfolioId}>
                      {row.nameAr}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="stack" style={{ gap: 'var(--s-1)', minWidth: '180px' }}>
                <span className="stat-label">المعلومة</span>
                <Select name="field_path" defaultValue={fieldPaths[0]}>
                  {fieldPaths.map((path) => (
                    <option key={path} value={path}>
                      {fieldLabel(path)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="stack" style={{ gap: 'var(--s-1)' }}>
                <span className="stat-label">المدة بالأيام</span>
                <Input name="ttl_days" ltr inputMode="numeric" defaultValue={90} size={5} />
              </label>
              <label className="stack" style={{ gap: 'var(--s-1)' }}>
                {/* The weight travels with the duration. A duration with no weight means
                    nothing in the confidence score, as on the retention screen. */}
                <span className="stat-label">الوزن في الدرجة</span>
                <Input name="weight" ltr inputMode="numeric" defaultValue={10} size={5} />
              </label>
            </div>
            <div>
              <SubmitButton
                variant="secondary"
                data-role="save-portfolio-ttl"
                pendingLabel="جارٍ الحفظ"
              >
                احفظ المدة
              </SubmitButton>
            </div>
          </form>

          {ttls.length === 0 ? (
            <div className="panel-body">
              <EmptyState>لا مدد خاصة بعد. كل مجموعة تتبع مدد المشترك.</EmptyState>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>المجموعة</th>
                    <th>المعلومة</th>
                    <th>المدة بالأيام</th>
                    <th>الوزن في الدرجة</th>
                  </tr>
                </thead>
                <tbody>
                  {ttls.map((ttl) => (
                    <tr key={`${ttl.portfolioId}:${ttl.fieldPath}`} data-role="portfolio-ttl-row">
                      <td>{groupName.get(ttl.portfolioId) ?? ttl.portfolioId}</td>
                      <td>{fieldLabel(ttl.fieldPath)}</td>
                      <td>
                        <bdi dir="ltr" className="mono">
                          {ttl.ttlDays}
                        </bdi>
                      </td>
                      <td>
                        <bdi dir="ltr" className="mono">
                          {ttl.weight}
                        </bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
