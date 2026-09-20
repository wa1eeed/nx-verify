import type { ReactElement } from 'react';
import { Card, CardEmpty, CardHead } from './ui/card';
import { Disclosure } from './ui/disclosure';
import { Input } from './ui/input';
import { Ltr } from './ui/ltr';
import { NoValue } from './ui/no-value';
import { Notice } from './ui/notice';
import { Select } from './ui/select';
import { Stat, StatGrid } from './ui/stat';
import { SubmitButton } from './ui/submit-button';
import { Table, Th } from './ui/table';
import { Tag } from './ui/tag';
import { PageHeader } from './page-header';
import { count } from './format';

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
      return {
        tone: 'refused',
        text: 'لم تُحفظ: الحصة الشهرية عدد صحيح، أو اتركها فارغة لبلا حد.',
      };
    case 'under-cost':
      return {
        tone: 'refused',
        text: 'لم يُحفظ: السعر أقل من تكلفة هذا التحقق، والسعر لا ينزل عن التكلفة.',
      };
    case 'retired':
      // Said in its own words rather than through the catch all below, because nothing was
      // typed wrongly here: the plan simply stopped being sold between the page being drawn
      // and «انقله» being pressed.
      return {
        tone: 'refused',
        text: 'لم يُنقل: هذه الباقة لم تعد معروضة للبيع. اختر باقة سارية.',
      };
    default:
      return { tone: 'refused', text: 'لم يُحفظ. تحقق من القيم المدخلة.' };
  }
  if (params.saved === undefined) {
    return null;
  }
  return params.saved === 'plan'
    ? { tone: 'done', text: 'نُقل المشترك إلى الباقة الجديدة.' }
    : { tone: 'done', text: 'حُفظت التغييرات.' };
}

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
  /*
   * Where a subscriber may actually be moved. `setTenantPackage` writes the commitment from
   * an active plan only and throws NX-4041 on anything else, and the action behind this form
   * catches nothing: picking a retired plan replaced the whole panel with the error screen.
   * Naming the retired plan is not enough on its own, so it is named and cannot be picked.
   */
  const onSale = packages.filter((plan) => plan.status === 'active');

  return (
    <div className="admin-screen" data-role="operator-packages">
      {notice === null ? null : (
        <Notice tone={notice.tone} role="plans-notice">
          {notice.text}
        </Notice>
      )}
      <PageHeader
        title="الباقات والاستثناءات"
        subtitle="ما تبيعه كل باقة من وحدات التحقق، وما وُعد به عميل بعينه خلافاً لها."
      />

      <StatGrid role="package-tiles">
        <Stat label="الباقات" value={<Ltr>{count(packages.length)}</Ltr>} />
        <Stat
          label="المشتركون"
          value={<Ltr>{count(subscribers.filter((row) => !row.isSandbox).length)}</Ltr>}
        />
        <Stat
          label="استثناءات مكتوبة"
          value={<Ltr>{count(exceptions)}</Ltr>}
          hint="كثرتها تعني أن الباقات لم تعد تصف السوق"
          tone={exceptions > 10 ? 'changed' : undefined}
        />
      </StatGrid>

      {packages.length === 0 ? (
        <Card variant="flush" role="no-packages" label="الباقات">
          <CardEmpty>لا باقة معرّفة بعد. تُضاف الباقات من شاشة «الأسعار والمنتجات».</CardEmpty>
        </Card>
      ) : (
        packages.map((plan) => (
          <Card
            key={plan.code}
            id={plan.code}
            variant="flush"
            role="package"
            item={plan.code}
            labelledBy={`plan-${plan.code}`}
          >
            <CardHead title={plan.nameAr} titleId={`plan-${plan.code}`}>
              <Tag tone="neutral">
                <Ltr>{plan.code}</Ltr>
              </Tag>
              <Tag tone="neutral">
                {billingLabel(plan.billingModel)} · <Ltr>{plan.termMonths}</Ltr> شهراً
              </Tag>
              {/*
                A retired plan is still on this screen, because subscribers are still on it and
                its modules still decide what they may run. It used to be drawn exactly like a
                plan we sell, and the move list below offered it as a destination in the same
                words, so nothing on the screen said it had been withdrawn.
              */}
              {plan.status === 'active' ? null : (
                <Tag tone="neutral" role="retired-plan">
                  متقاعدة
                </Tag>
              )}
            </CardHead>

            <div className="admin-table">
              <Table label={`وحدات ${plan.nameAr}`}>
                <thead>
                  <tr>
                    <Th>الوحدة</Th>
                    <Th>مشمولة</Th>
                    <Th>الحصة الشهرية</Th>
                    <Th>سعر الوحدة</Th>
                    <Th>
                      <span className="visually-hidden">إجراء</span>
                    </Th>
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
                          {enabled ? <Tag tone="accent-2">نعم</Tag> : <Tag tone="neutral">لا</Tag>}
                        </td>
                        {/*
                          One form for the quota and the price, because they are one row of the
                          plan. The quota used to be read only in this column while the price
                          beside it was editable, and saving the price wiped the quota anyway.
                        */}
                        <td>
                          <Input
                            form={`plan-${plan.code}-${product.code}`}
                            name="monthly_quota"
                            defaultValue={included?.monthlyQuota ?? ''}
                            placeholder="بلا حد"
                            aria-label={`الحصة الشهرية من ${product.nameAr}`}
                            data-role="monthly-quota"
                            ltr
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
                            <Input
                              name="unit_price"
                              defaultValue={
                                included?.unitPriceHalalas === null ||
                                included?.unitPriceHalalas === undefined
                                  ? ''
                                  : (included.unitPriceHalalas / 100).toFixed(2)
                              }
                              placeholder="من قائمة الأسعار"
                              inputMode="decimal"
                              aria-label="سعر الوحدة بالريال"
                              data-role="unit-price"
                              ltr
                            />
                            <SubmitButton
                              variant="secondary"
                              data-role="save-price"
                              pendingLabel="جارٍ الحفظ"
                            >
                              حفظ
                            </SubmitButton>
                          </form>
                        </td>
                        <td>
                          <form action={setProductAction} className="inline">
                            <input type="hidden" name="package_code" value={plan.code} />
                            <input type="hidden" name="product_code" value={product.code} />
                            <input
                              type="hidden"
                              name="enabled"
                              value={enabled ? 'false' : 'true'}
                            />
                            <SubmitButton variant="ghost" data-role="toggle-product">
                              {enabled ? 'تعطيل' : 'تفعيل'}
                            </SubmitButton>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </Card>
        ))
      )}

      <Card variant="flush" role="subscribers" labelledBy="subscribers-title">
        <CardHead title="المشتركون" titleId="subscribers-title" note="الباقة والاستثناءات" />

        {subscribers.length === 0 ? (
          <CardEmpty>لا مشترك بعد. لا أحد يُنقل بين الباقات ولا يُكتب له استثناء.</CardEmpty>
        ) : (
          <div className="admin-table">
            <Table label="المشتركون وباقاتهم">
              <thead>
                <tr>
                  <Th>المشترك</Th>
                  <Th>الباقة</Th>
                  <Th>السعة</Th>
                  <Th>الاستثناءات</Th>
                  <Th>نقل إلى باقة</Th>
                </tr>
              </thead>
              <tbody>
                {subscribers.map((row) => (
                  <tr
                    key={row.tenantId}
                    data-role="subscriber"
                    data-sandbox={String(row.isSandbox)}
                  >
                    <td>
                      {row.legalName}{' '}
                      {row.isSandbox ? (
                        <Tag tone="neutral" role="sandbox-tag">
                          بيئة اختبار
                        </Tag>
                      ) : null}
                      <div className="faint">
                        <Ltr>{row.slug}</Ltr>
                      </div>
                    </td>
                    <td>
                      {/* Arabic words are not an identifier, so they stay out of the LTR run. */}
                      {row.packageCode === null ? (
                        <NoValue>بلا باقة</NoValue>
                      ) : (
                        <Ltr>{row.packageCode}</Ltr>
                      )}
                    </td>
                    <td>
                      {row.includedTransactions === null ? (
                        <NoValue>بلا حد</NoValue>
                      ) : (
                        <Ltr>
                          {count(row.transactionsUsed)}/{count(row.includedTransactions)}
                        </Ltr>
                      )}
                    </td>
                    <td>
                      {row.overrides.length === 0 ? (
                        <NoValue>لا استثناءات</NoValue>
                      ) : (
                        <ul className="admin-offer-list">
                          {row.overrides.map((override) => (
                            <li
                              key={override.productCode}
                              className="admin-offer"
                              data-role="override"
                            >
                              <span className="admin-offer-line">
                                <span>
                                  {override.productNameAr}
                                  {': '}
                                  {override.enabled === true
                                    ? 'مفعّلة استثناءً'
                                    : 'معطّلة استثناءً'}
                                </span>
                                <form action={setOverrideAction} className="inline">
                                  <input type="hidden" name="tenant_id" value={row.tenantId} />
                                  <input
                                    type="hidden"
                                    name="product_code"
                                    value={override.productCode}
                                  />
                                  <input type="hidden" name="enabled" value="" />
                                  <SubmitButton variant="ghost" data-role="clear-override">
                                    رفع الاستثناء
                                  </SubmitButton>
                                </form>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      <form action={setOverrideAction} className="row admin-inline-form">
                        <input type="hidden" name="tenant_id" value={row.tenantId} />
                        <Select name="product_code" aria-label="وحدة">
                          {allProducts.map((product) => (
                            <option key={product.code} value={product.code}>
                              {product.nameAr}
                            </option>
                          ))}
                        </Select>
                        <Select name="enabled" aria-label="الحالة">
                          <option value="true">تفعيل استثناءً</option>
                          <option value="false">تعطيل استثناءً</option>
                        </Select>
                        <SubmitButton
                          variant="secondary"
                          data-role="add-override"
                          pendingLabel="جارٍ الكتابة"
                        >
                          اكتب استثناءً
                        </SubmitButton>
                      </form>
                    </td>
                    <td>
                      {/*
                        Moving a subscriber changes what they may run and what they are charged
                        for it, in one press and with nothing to undo it. Two steps, and the
                        consequence above the button that causes it, the same pattern the API
                        key revoke uses (ADR-167).
                      */}
                      <Disclosure
                        role="assign-package"
                        summary="انقله إلى باقة أخرى"
                        consequence="تُستبدل باقته الحالية: المدة والرسوم والسعة والوحدات المشمولة تصير كلها من الباقة الجديدة. الاستثناءات المكتوبة له تبقى كما هي."
                      >
                        {onSale.length === 0 ? (
                          // Nothing to move onto, said instead of a button that can only fail.
                          <span className="faint" data-role="no-destination">
                            لا باقة معروضة للبيع الآن، فلا وجهة يُنقل إليها.
                          </span>
                        ) : (
                          <form action={assignAction} className="row">
                            <input type="hidden" name="tenant_id" value={row.tenantId} />
                            <Select name="package_code" aria-label="باقة">
                              {packages.map((plan) => (
                                <option
                                  key={plan.code}
                                  value={plan.code}
                                  disabled={plan.status !== 'active'}
                                >
                                  {plan.status === 'active'
                                    ? plan.nameAr
                                    : `${plan.nameAr} · متقاعدة`}
                                </option>
                              ))}
                            </Select>
                            <SubmitButton
                              variant="secondary"
                              data-role="assign-confirm"
                              pendingLabel="جارٍ النقل"
                            >
                              انقله
                            </SubmitButton>
                          </form>
                        )}
                      </Disclosure>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
