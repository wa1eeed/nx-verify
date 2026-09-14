import type { ReactElement } from 'react';
import { PageHeader, Panel } from './page-header';
import { CheckList, type CheckOption } from './check-list';
import { CheckResults, type CheckResultView } from './check-results';

/**
 * Adding a customer.
 *
 * Three decisions and one button, in the order a person makes them: what kind of customer
 * this is, the number that identifies them, and which checks to run. The file is created
 * by the first answer an authority gives, not by the form: nothing a person types here is
 * recorded as a fact about the customer (rule 6), only as the question asked.
 *
 * The kind is chosen before the form is drawn, because it decides which number is asked for
 * and which checks exist at all. A company and a sole establishment share one choice: which
 * of the two it is, the registry says.
 */

export type NewCustomerKind = 'business' | 'freelancer';

export interface SandboxSample {
  input: string;
  titleAr: string;
  expectedAr: string;
}

export interface NewCustomerView {
  kind: NewCustomerKind;
  checks: CheckOption[];
  fromPackage: boolean;
  capacityRemaining: number | null;
  /** Issued when the form is drawn. Pressing twice is the same verification. */
  bundle: string;
  error: string | null;
  results: CheckResultView[] | null;
  isSandbox: boolean;
  samples: SandboxSample[];
}

const ERRORS: Readonly<Record<string, string>> = {
  unn: 'الرقم الموحد للمنشأة عشرة أرقام يبدأ بالرقم 7.',
  freelancer: 'رقم الهوية عشرة أرقام يبدأ بـ1 أو 2، ورقم الوثيقة بالشكل FL-013988291.',
  iban: 'رقم الآيبان السعودي يبدأ بـSA ويتبعه 22 رقماً.',
  checks: 'حدّد عملية تحقق واحدة على الأقل.',
};

export function NewCustomer({
  view,
  action,
}: {
  view: NewCustomerView;
  action: string | ((formData: FormData) => void | Promise<void>);
}): ReactElement {
  const business = view.kind === 'business';
  const needsIban = view.checks.some(
    (check) => check.productCode.startsWith('IBAN_') && check.disabledReasonAr === null,
  );

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="عميل جديد"
        subtitle="اختر نوع العميل وأدخل رقمه، ثم حدّد عمليات التحقق. يُنشأ الملف ويُملأ من الجهات الرسمية مباشرة."
      />

      {view.results ? <CheckResults results={view.results} /> : null}

      <nav className="kind-choice" aria-label="نوع العميل">
        <a
          className="kind-option"
          href="/verifications/new?kind=business"
          {...(business ? { 'aria-current': 'page' as const } : {})}
        >
          <strong>منشأة</strong>
          <span className="muted">شركة أو مؤسسة فردية، برقمها الموحد. السجل يحدد أيهما.</span>
        </a>
        <a
          className="kind-option"
          href="/verifications/new?kind=freelancer"
          {...(!business ? { 'aria-current': 'page' as const } : {})}
        >
          <strong>عامل حر</strong>
          <span className="muted">فرد يعمل بوثيقة عمل حر، برقم هويته ورقم وثيقته.</span>
        </a>
      </nav>

      {view.error ? (
        <p className="sign-in-error" role="alert" data-role="form-error">
          {ERRORS[view.error] ?? 'تعذّر تنفيذ الطلب.'}
        </p>
      ) : null}

      <form
        action={action}
        className="stack"
        style={{ gap: 'var(--s-5)' }}
        data-role="new-customer-form"
      >
        <input type="hidden" name="kind" value={business ? 'BUSINESS' : 'FREELANCER'} />
        <input type="hidden" name="bundle" value={view.bundle} />

        <Panel title={business ? 'رقم المنشأة' : 'بيانات العامل الحر'} role="identity">
          <div
            className="panel-body grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
          >
            {business ? (
              <div className="stack" style={{ gap: 'var(--s-1)' }}>
                <label htmlFor="unn">الرقم الموحد للمنشأة</label>
                <input
                  id="unn"
                  name="unn"
                  inputMode="numeric"
                  dir="ltr"
                  className="mono"
                  placeholder="7001272184"
                  required
                  maxLength={10}
                  autoComplete="off"
                />
                <span className="faint">عشرة أرقام يبدأ بـ7، ويظهر في شهادة السجل التجاري.</span>
              </div>
            ) : (
              <>
                <div className="stack" style={{ gap: 'var(--s-1)' }}>
                  <label htmlFor="national_id">رقم الهوية الوطنية أو الإقامة</label>
                  <input
                    id="national_id"
                    name="national_id"
                    inputMode="numeric"
                    dir="ltr"
                    className="mono"
                    placeholder="1107454009"
                    required
                    maxLength={10}
                    autoComplete="off"
                  />
                </div>
                <div className="stack" style={{ gap: 'var(--s-1)' }}>
                  <label htmlFor="certificate_number">رقم وثيقة العمل الحر</label>
                  <input
                    id="certificate_number"
                    name="certificate_number"
                    dir="ltr"
                    className="mono"
                    placeholder="FL-013988291"
                    required
                    autoComplete="off"
                  />
                </div>
              </>
            )}
            {needsIban ? (
              <div className="stack" style={{ gap: 'var(--s-1)' }}>
                <label htmlFor="iban">رقم الآيبان (اختياري)</label>
                <input
                  id="iban"
                  name="iban"
                  dir="ltr"
                  className="mono"
                  placeholder="SA2810000011100000461309"
                  autoComplete="off"
                />
                <span className="faint">مطلوب لعمليات الحساب البنكي فقط.</span>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="عمليات التحقق" aside="كل عملية تملأ قسماً من ملف العميل" role="checks">
          <div className="panel-body">
            <CheckList
              options={view.checks}
              fromPackage={view.fromPackage}
              capacityRemaining={view.capacityRemaining}
            />
          </div>
        </Panel>

        <div className="row" style={{ justifyContent: 'flex-start' }}>
          <button type="submit" className="btn btn-primary" data-role="start-checks">
            تحقق وأنشئ الملف
          </button>
          <span className="faint">
            لا يُحتسب ما يتعذّر تنفيذه، ولا تُكرَّر العملية إن ضغطت مرتين.
          </span>
        </div>
      </form>

      {view.isSandbox && view.samples.length > 0 ? (
        <Panel
          title="بيانات تجريبية"
          aside="بيئة الاختبار"
          role="samples"
          note="استخدم هذه الأرقام في بيئة الاختبار لترى كل حالة كما ستظهر في الإنتاج."
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>المدخل</th>
                  <th>الحالة</th>
                  <th>ما ستراه</th>
                </tr>
              </thead>
              <tbody>
                {view.samples.map((sample) => (
                  <tr key={`${sample.input}-${sample.titleAr}`}>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {sample.input}
                      </bdi>
                    </td>
                    <td>{sample.titleAr}</td>
                    <td className="muted">{sample.expectedAr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
