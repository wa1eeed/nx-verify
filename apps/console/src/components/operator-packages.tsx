import type { ReactElement } from 'react';
import { SubmitButton } from './ui/submit-button';
import { Notice } from './ui/notice';

/** What the last save did, or why it was refused. */
export function planNoticeAr(params: {
  refused?: string | undefined;
  saved?: string | undefined;
}): { tone: 'done' | 'refused'; text: string } | null {
  switch (params.refused) {
    case undefined:
      break;
    case 'price':
      return { tone: 'refused', text: 'لم يُحفظ: السعر غير صالح. اكتبه بالأرقام، مثل 4.50' };
    case 'quota':
      return { tone: 'refused', text: 'لم تُحفظ: الحصة الشهرية عدد صحيح، أو اتركها فارغة لبلا حد.' };
    case 'under-cost':
      return {
        tone: 'refused',
        text: 'لم يُحفظ: السعر أقل من تكلفة هذا التحقق، والسعر لا ينزل عن التكلفة.',
      };
    default:
      return { tone: 'refused', text: 'لم يُحفظ. تحقق من القيم المدخلة.' };
  }
  return params.saved === undefined ? null : { tone: 'done', text: 'حُفظت التغييرات.' };
}
import { PageHeader, Panel } from './page-header';

/**
 * The plans, and the exceptions written under them.
 *
 * This is the screen the commercial side lives in: which modules a plan sells, and which
 * one customer was promised something different. The second half is what keeps a
 * catalogue of three plans from becoming a catalogue of ninety, so it is on the same
 * screen rather than buried a level down: the person adding an exception should see how
 * many already exist.
 *
 * Operator only, behind an operator token and an operator connection. Nothing here reads
 * a subscriber's data; every table on it says what somebody bought.
 */

export interface PackageProductView {
  productCode: string;
  productNameAr: string;
  enabled: boolean;
  monthlyQuota: number | null;
  /** The plan's own price for this module. Null defers to the subscriber's price book. */
  unitPriceHalalas: number | null;
}

export interface PackageView {
  code: string;
  nameAr: string;
  billingModel: string;
  termMonths: number;
  includedTransactions: number | null;
  platformFeeHalalas: number;
  status: string;
  products: PackageProductView[];
}

export interface SubscriberView {
  tenantId: string;
  legalName: string;
  slug: string;
  isSandbox: boolean;
  packageCode: string | null;
  includedTransactions: number | null;
  transactionsUsed: number;
  overrides: { productCode: string; productNameAr: string; enabled: boolean | null }[];
}

const BILLING_LABELS: Record<string, string> = {
  PAYG: 'دفع لكل عملية',
  MONTHLY: 'باقة شهرية',
  ANNUAL: 'التزام سنوي',
};

export function billingLabel(model: string): string {
  return BILLING_LABELS[model] ?? model;
}

export function OperatorPackages({
  notice,
  packages,
  subscribers,
  allProducts,
  setProductAction,
  setOverrideAction,
  assignAction,
}: {
  notice: { tone: 'done' | 'refused'; text: string } | null;
  packages: PackageView[];
  subscribers: SubscriberView[];
  allProducts: { code: string; nameAr: string }[];
  setProductAction: string | ((formData: FormData) => void | Promise<void>);
  setOverrideAction: string | ((formData: FormData) => void | Promise<void>);
  assignAction: string | ((formData: FormData) => void | Promise<void>);
}): ReactElement {
  const exceptions = subscribers.reduce((total, row) => total + row.overrides.length, 0);

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      {notice === null ? null : (
        <Notice tone={notice.tone} role="plans-notice">
          {notice.text}
        </Notice>
      )}
      <PageHeader
        title="الباقات والاستثناءات"
        subtitle="ما تبيعه كل باقة من وحدات التحقق، وما وُعد به عميل بعينه خلافاً لها."
      />

      <section className="grid" data-role="package-tiles">
        <article className="stat">
          <span className="stat-label">الباقات</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {packages.length}
            </bdi>
          </strong>
        </article>
        <article className="stat">
          <span className="stat-label">المشتركون</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {subscribers.filter((row) => !row.isSandbox).length}
            </bdi>
          </strong>
        </article>
        <article className="stat" {...(exceptions > 10 ? { 'data-tone': 'changed' } : {})}>
          <span className="stat-label">استثناءات مكتوبة</span>
          <strong className="stat-value">
            <bdi dir="ltr" className="mono">
              {exceptions}
            </bdi>
          </strong>
          <span className="stat-hint">كثرتها تعني أن الباقات لم تعد تصف السوق</span>
        </article>
      </section>

      {packages.map((plan) => (
        <Panel
          key={plan.code}
          id={plan.code}
          title={`${plan.nameAr} (${plan.code})`}
          aside={`${billingLabel(plan.billingModel)} · ${plan.termMonths} شهراً`}
          role="package"
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الوحدة</th>
                  <th>مشمولة</th>
                  <th>الحصة الشهرية</th>
                  <th>سعر الوحدة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {allProducts.map((product) => {
                  const included = plan.products.find(
                    (entry) => entry.productCode === product.code,
                  );
                  const enabled = included?.enabled === true;

                  return (
                    <tr
                      key={product.code}
                      data-role="package-product"
                      data-enabled={String(enabled)}
                    >
                      <td>{product.nameAr}</td>
                      <td>
                        {enabled ? (
                          <span
                            className="badge"
                            style={{ borderColor: 'var(--fresh-line)', color: 'var(--fresh-fg)' }}
                          >
                            نعم
                          </span>
                        ) : (
                          <span className="badge">لا</span>
                        )}
                      </td>
                      {/*
                        One form for the quota and the price, because they are one row of the
                        plan. The quota used to be read only in this column while the price
                        beside it was editable, and saving the price wiped the quota anyway.
                      */}
                      <td>
                        <input
                          form={`plan-${plan.code}-${product.code}`}
                          name="monthly_quota"
                          defaultValue={included?.monthlyQuota ?? ''}
                          placeholder="بلا حد"
                          dir="ltr"
                          className="mono"
                          style={{ width: '6rem' }}
                          aria-label={`الحصة الشهرية من ${product.nameAr}`}
                          data-role="monthly-quota"
                        />
                      </td>
                      <td>
                        <form
                          id={`plan-${plan.code}-${product.code}`}
                          action={setProductAction}
                          className="row"
                        >
                          <input type="hidden" name="package_code" value={plan.code} />
                          <input type="hidden" name="product_code" value={product.code} />
                          <input type="hidden" name="enabled" value={String(enabled)} />
                          <input
                            name="unit_price"
                            defaultValue={
                              included?.unitPriceHalalas === null ||
                              included?.unitPriceHalalas === undefined
                                ? ''
                                : (included.unitPriceHalalas / 100).toFixed(2)
                            }
                            placeholder="من قائمة الأسعار"
                            dir="ltr"
                            className="mono"
                            style={{ width: '7rem' }}
                            aria-label="سعر الوحدة بالريال"
                            data-role="unit-price"
                          />
                          <SubmitButton variant="secondary" data-role="save-price" pendingLabel="جارٍ الحفظ">
                            حفظ
                          </SubmitButton>
                        </form>
                      </td>
                      <td>
                        <form action={setProductAction} className="inline">
                          <input type="hidden" name="package_code" value={plan.code} />
                          <input type="hidden" name="product_code" value={product.code} />
                          <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
                          <button type="submit" className="link" data-role="toggle-product">
                            {enabled ? 'تعطيل' : 'تفعيل'}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}

      <Panel title="المشتركون" aside="الباقة والاستثناءات" role="subscribers">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>المشترك</th>
                <th>الباقة</th>
                <th>السعة</th>
                <th>الاستثناءات</th>
                <th>نقل إلى باقة</th>
              </tr>
            </thead>
            <tbody>
              {subscribers.map((row) => (
                <tr key={row.tenantId} data-role="subscriber" data-sandbox={String(row.isSandbox)}>
                  <td>
                    {row.legalName}
                    {row.isSandbox ? (
                      <span className="muted" data-role="sandbox-tag">
                        {' '}
                        · بيئة اختبار
                      </span>
                    ) : null}
                    <div className="faint">
                      <bdi dir="ltr" className="mono">
                        {row.slug}
                      </bdi>
                    </div>
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {row.packageCode ?? 'بلا باقة'}
                    </bdi>
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {row.includedTransactions === null
                        ? 'بلا حد'
                        : `${row.transactionsUsed}/${row.includedTransactions}`}
                    </bdi>
                  </td>
                  <td>
                    {row.overrides.length === 0 ? (
                      <span className="muted">لا استثناءات</span>
                    ) : (
                      <ul style={{ margin: 0, paddingInlineStart: '1rem' }}>
                        {row.overrides.map((override) => (
                          <li key={override.productCode} data-role="override">
                            {override.productNameAr}
                            {': '}
                            {override.enabled === true ? 'مفعّلة استثناءً' : 'معطّلة استثناءً'}
                            <form action={setOverrideAction} className="inline">
                              <input type="hidden" name="tenant_id" value={row.tenantId} />
                              <input
                                type="hidden"
                                name="product_code"
                                value={override.productCode}
                              />
                              <input type="hidden" name="enabled" value="" />
                              <button type="submit" className="link" data-role="clear-override">
                                {' '}
                                رفع الاستثناء
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    )}

                    <form
                      action={setOverrideAction}
                      className="row"
                      style={{ marginBlockStart: 'var(--s-2)' }}
                    >
                      <input type="hidden" name="tenant_id" value={row.tenantId} />
                      <select name="product_code" aria-label="وحدة" style={{ width: 'auto' }}>
                        {allProducts.map((product) => (
                          <option key={product.code} value={product.code}>
                            {product.nameAr}
                          </option>
                        ))}
                      </select>
                      <select name="enabled" aria-label="الحالة" style={{ width: 'auto' }}>
                        <option value="true">تفعيل استثناءً</option>
                        <option value="false">تعطيل استثناءً</option>
                      </select>
                      <button type="submit" className="btn btn-secondary" data-role="add-override">
                        اكتب استثناءً
                      </button>
                    </form>
                  </td>
                  <td>
                    <form action={assignAction} className="row">
                      <input type="hidden" name="tenant_id" value={row.tenantId} />
                      <select name="package_code" aria-label="باقة" style={{ width: 'auto' }}>
                        {packages.map((plan) => (
                          <option key={plan.code} value={plan.code}>
                            {plan.nameAr}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="btn btn-secondary"
                        data-role="assign-package"
                      >
                        نقل
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
