import Link from 'next/link';
import type { ReactElement } from 'react';
import type {
  CreditBundle,
  PlanSummary,
  PlatformSettings,
  ProductPricingRow,
  SpecialPrice,
} from '@nx-verify/core';
import { PageHeader } from '../page-header';
import { ButtonLink, IconButton } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Ltr } from '../ui/ltr';
import { Notice } from '../ui/notice';
import { SubmitButton } from '../ui/submit-button';
import { Table, Th } from '../ui/table';
import { Tag } from '../ui/tag';
import { TagToggle } from '../ui/tag-toggle';
import { count, riyals } from '../format';
import { AddPlanDialog, BundleDialog, PlanTermsDialog, SpecialPriceDialog } from './dialogs';
import {
  bundleTermsAr,
  discountAr,
  lastChangeAr,
  operationsAr,
  planLinesAr,
  priceField,
  ratePctField,
  sar,
  specialLineAr,
} from './model';
import { VerificationSettings, type SectionsView } from './settings';
import { VatPanel, type VatPeriodView } from './vat';

/**
 * The prices and products of the platform (handoff screen 05), on the administration panel's
 * dark ground.
 *
 * What each check costs us, what it sells for, what that leaves, and how much it was used;
 * the three other ways a subscriber pays; and how verification behaves for all of them. The
 * price table and the settings are one form, saved by the one primary button in the head;
 * bundles, plans and special prices are each added through a dialog of their own.
 */

export const PRICING_FORM = 'pricing-form';

type Action = (formData: FormData) => Promise<void>;

export interface AdminPricingView {
  canEditPricing: boolean;
  canEditSettings: boolean;
  lastChange: { byName: string; at: Date } | null;
  notice: { tone: 'done' | 'refused'; text: string } | null;
  products: readonly ProductPricingRow[];
  /** The tax rule in force today, so the table says what a subscriber actually pays. */
  vat: { registered: boolean; ratePct: number };
  /** Every rule ever declared, newest first, for the panel that sets the next one. */
  vatPeriods: readonly VatPeriodView[];
  today: string;
  bundles: readonly CreditBundle[];
  /**
   * Every bundle ever defined, retired ones included, for the dialog alone.
   *
   * A bundle is named after its number of operations, so the dialog has to know that the
   * number just typed is already taken before it offers to add it: the alternative is the
   * silent replacement this screen used to do. It carries the price and the term as they
   * stand too, because «سيُستبدل» without the figures it replaces is a warning nobody can
   * weigh (ADR-171).
   */
  definedBundles: readonly {
    code: string;
    operations: number;
    priceHalalas: number;
    validityMonths: number;
    retired: boolean;
  }[];
  plans: readonly PlanSummary[];
  specialPrices: readonly SpecialPrice[];
  settings: Pick<
    PlatformSettings,
    | 'maxAttempts'
    | 'resultValidityDays'
    | 'nameMatchThresholdPct'
    | 'registryAlertDays'
    | 'userSecondStep'
    | 'bankAccountName'
    | 'bankName'
    | 'bankIban'
    | 'transferNote'
  >;
  sections: SectionsView;
  subscribers: readonly { tenantId: string; legalName: string }[];
  /** The margin under which a price is said to be thin. */
  minimumMarginPct: number;
}

export interface AdminPricingActions {
  save: Action;
  addBundle: Action;
  retireBundle: Action;
  addPlan: Action;
  setPlanTerms: Action;
  setSpecialPrice: Action;
  setVat: Action;
}

function StatusCell({
  product,
  editable,
}: {
  product: ProductPricingRow;
  editable: boolean;
}): ReactElement {
  if (product.availability === 'COMING_SOON') {
    return <Tag tone="neutral">قريباً</Tag>;
  }
  if (!editable) {
    return product.status === 'active' ? (
      <Tag tone="accent-2">مفعّل</Tag>
    ) : (
      <Tag tone="neutral">موقوف</Tag>
    );
  }
  return (
    <TagToggle
      name="on_sale"
      value={product.productCode}
      form={PRICING_FORM}
      defaultChecked={product.status === 'active'}
      on="مفعّل"
      off="موقوف"
      label={`${product.nameAr} متاح للبيع`}
      role="product-status"
    />
  );
}

/**
 * What each block on this screen actually sets, and how the four relate (ADR-161).
 *
 * The screen configures four commercial things that all read as «credit», and it configured
 * them in four blocks with nothing saying which is which: a price per check, a plan, a prepaid
 * bundle, and a price for one subscriber. The person setting them has to know the order they
 * are spent in, because that order is what decides whether a plan's price or a bundle's price
 * is the one a subscriber actually pays.
 *
 * Said once, at the top, in the order a verification is charged.
 */
function PricingModel(): ReactElement {
  return (
    <Card role="pricing-model" labelledBy="pricing-model-title">
      <h2 className="card-title admin-card-title" id="pricing-model-title">
        كيف تُحتسب عملية التحقق
      </h2>
      <p className="admin-card-note">
        {/*
          Two questions, not one list. The first draft numbered «سعر المنتج» as step one under a
          paragraph that said the plan comes first, and a reader takes the numbers. They are
          different axes: who pays, and at what price.
        */}
        سؤالان مختلفان لكل عملية: <strong>من يدفعها</strong>، و<strong>بأي سعر</strong>.
      </p>

      <h3 className="stat-label">من يدفع العملية، بالترتيب</h3>
      <ol className="spend-order" data-role="pricing-model-payer">
        <li className="spend-step" data-step="free">
          <span className="spend-step-rank" aria-hidden="true">
            ١
          </span>
          <span className="stack" style={{ gap: 0, flex: 1 }}>
            <strong>نافذة إعادة التحقق المجانية</strong>
            <span className="faint">
              إعادة التحقق من العميل نفسه خلال المدة المحددة في باقته لا تُحتسب إطلاقاً. والمدة
              مكتوبة على بطاقة كل باقة، وتُضبط من زر شروطها.
            </span>
          </span>
        </li>
        <li className="spend-step" data-step="plan">
          <span className="spend-step-rank" aria-hidden="true">
            ٢
          </span>
          <span className="stack" style={{ gap: 0, flex: 1 }}>
            <strong>العمليات المشمولة في باقته</strong>
            <span className="faint">ما دامت لم تنفد في هذه المدة.</span>
          </span>
        </li>
        <li className="spend-step" data-step="bundle">
          <span className="spend-step-rank" aria-hidden="true">
            ٣
          </span>
          <span className="stack" style={{ gap: 0, flex: 1 }}>
            <strong>عملية من حزمة اشتراها</strong>
            <span className="faint">
              تُصرف على أي تحقق مهما كان سعره، والأقرب انتهاءً أولاً. ولذلك سعر العملية في الحزمة
              لا ينزل عن تكلفة أغلى تحقق نبيعه.
            </span>
          </span>
        </li>
        <li className="spend-step" data-step="wallet">
          <span className="spend-step-rank" aria-hidden="true">
            ٤
          </span>
          <span className="stack" style={{ gap: 0, flex: 1 }}>
            <strong>رصيده بالريال</strong>
            <span className="faint">يُخصم منه سعر ذلك التحقق.</span>
          </span>
        </li>
      </ol>

      <h3 className="stat-label" style={{ marginBlockStart: 'var(--space-4)' }}>
        وبأي سعر، بالترتيب
      </h3>
      <ol className="spend-order" data-role="pricing-model-price">
        <li className="spend-step" data-step="special">
          <span className="spend-step-rank" aria-hidden="true">
            ١
          </span>
          <span className="stack" style={{ gap: 0, flex: 1 }}>
            <strong>سعره الخاص، إن كان له</strong>
            <span className="faint">
              سعر منتج واحد أو خصم على كل المنتجات، لمشترك واحد. ولا ينزل عن التكلفة.
            </span>
          </span>
        </li>
        <li className="spend-step" data-step="package-price">
          <span className="spend-step-rank" aria-hidden="true">
            ٢
          </span>
          <span className="stack" style={{ gap: 0, flex: 1 }}>
            <strong>سعر المنتج داخل باقته</strong>
            <span className="faint">يُضبط في «الباقات والاشتراكات».</span>
          </span>
        </li>
        <li className="spend-step" data-step="product">
          <span className="spend-step-rank" aria-hidden="true">
            ٣
          </span>
          <span className="stack" style={{ gap: 0, flex: 1 }}>
            <strong>السعر المعروض في الجدول أدناه</strong>
            <span className="faint">السعر الأساسي لمن لا سعر خاص له ولا باقة تحدّده.</span>
          </span>
        </li>
      </ol>
    </Card>
  );
}

export function AdminPricing({
  view,
  actions,
}: {
  view: AdminPricingView;
  actions: AdminPricingActions;
}): ReactElement {
  const editable = view.canEditPricing || view.canEditSettings;

  return (
    <div className="admin-screen" data-role="admin-pricing">
      <PageHeader
        title="الأسعار والمنتجات"
        subtitle={lastChangeAr(view.lastChange)}
        action={
          <form id={PRICING_FORM} action={actions.save} className="admin-head-actions">
            {view.canEditPricing ? <input type="hidden" name="prices_present" value="1" /> : null}
            <ButtonLink href="/operator/access?scope=pricing" data-role="change-log">
              سجل التغييرات
            </ButtonLink>
            {editable ? (
              <SubmitButton variant="primary" pendingLabel="جارٍ الحفظ" data-role="save-pricing">
                حفظ التغييرات
              </SubmitButton>
            ) : null}
          </form>
        }
      />

      {view.notice === null ? null : (
        <Notice tone={view.notice.tone} role="pricing-notice">
          {view.notice.text}
        </Notice>
      )}

      <PricingModel />

      <Card variant="flush" role="price-table" labelledBy="price-table-title">
        <div className="admin-card-head">
          <h2 className="card-title admin-card-title" id="price-table-title">
            سعر كل منتج تحقق
          </h2>
          {/*
            This line used to read «العمليات الفاشلة لا تُحسب», which is not true of a NOT_FOUND
            answer: the authority answered, and the price row charges it at its own share. The
            margin beside it is the margin of a run where every step answered, which is its
            best case, so the screen says on what the figure is computed.
          */}
          <p className="admin-card-note">
            السعر بالريال بلا ضريبة لعملية ناجحة كاملة · نتيجة «غير موجود» تُحسب بنسبتها أدناه،
            والفشل التقني والخطوة المتخطاة لا تُحسبان · الهامش محسوب على عملية ناجحة كاملة
            {view.vat.registered ? (
              <>
                {' · '}السعر المعروض للمشترك يشمل ضريبة {view.vat.ratePct}%
              </>
            ) : (
              <>{' · '}المنصة غير مسجّلة في الضريبة، فلا تُضاف على السعر</>
            )}
          </p>
        </div>
        {view.products.length === 0 ? (
          <p className="admin-empty" data-role="empty-state">
            لا منتج تحقق في الكتالوج بعد.
          </p>
        ) : (
          <div className="admin-table">
            <Table label="سعر كل منتج تحقق">
              <thead>
                <tr>
                  <Th>المنتج</Th>
                  <Th>المزوّد</Th>
                  <Th>التكلفة</Th>
                  <Th>سعر البيع</Th>
                  <Th>نسب الحالات الأخرى</Th>
                  <Th>يدفعه المشترك</Th>
                  <Th>الهامش</Th>
                  <Th>استهلاك 30 يوماً</Th>
                  <Th>الحالة</Th>
                </tr>
              </thead>
              <tbody>
                {view.products.map((product) => (
                  <tr
                    key={product.productCode}
                    data-role="price-row"
                    data-product={product.productCode}
                  >
                    <td>
                      <span className="stack" style={{ gap: 0 }}>
                        {product.nameAr}
                        {/*
                          A composite check carries one price shared between its calls by
                          step_weight (compute.ts), so a run where one call answered is not
                          billed at the whole price. The count is read only here: which call
                          weighs what belongs to the catalogue, and the catalogue is rows
                          (rule 8), not a field on a pricing screen.
                        */}
                        {product.stepCount > 1 ? (
                          <span className="faint" data-role="steps">
                            {product.stepCount} خطوات · يتقاسمن السعر بأوزانهن
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td data-role="provider">
                      {product.providers.length === 0 ? (
                        <span className="admin-empty-cell">لم يُوجَّه</span>
                      ) : (
                        <span className="admin-providers">
                          {product.providers.join('، ')}
                        </span>
                      )}
                    </td>
                    <td data-role="cost">
                      {product.costKnown ? (
                        <span className="stack" style={{ gap: 0 }}>
                          <Ltr>{riyals(product.costHalalas)}</Ltr>
                          {/*
                            What we hand the provider, and what of it we keep. While the
                            platform is unregistered the tax in their bill is ours to eat, and
                            saying so here is the difference between a margin somebody trusts
                            and one they recompute by hand.
                          */}
                          {product.costVatBps > 0 ? (
                            <span className="admin-sub" data-role="cost-vat">
                              {view.vat.registered
                                ? `صافيها ${riyals(product.effectiveCostHalalas)} بعد استرداد الضريبة`
                                : 'شاملة ضريبة المزوّد ولا تُسترد'}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="admin-empty-cell" data-role="cost-unknown">
                          غير مسجّلة
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="stack" style={{ gap: 'var(--space-1)' }}>
                        <span className="admin-price-field">
                          <Input
                            form={PRICING_FORM}
                            name={`price:${product.productCode}`}
                            defaultValue={priceField(product.priceHalalas)}
                            inputMode="decimal"
                            aria-label={`سعر بيع ${product.nameAr} بالريال`}
                            disabled={!view.canEditPricing}
                            ltr
                          />
                        </span>
                        {/*
                          A check on sale with no price fails on every run at resolvePrice with
                          NX-4041, and nothing said so: the cell showed «·» and the margin column
                          another. Amber, because it is something to look at rather than
                          something that already failed (ADR-122).
                        */}
                        {product.priceHalalas === null &&
                        product.availability === 'AVAILABLE' &&
                        product.status === 'active' ? (
                          <Tag tone="accent" role="no-price">
                            بلا سعر · كل تشغيل يفشل
                          </Tag>
                        ) : null}
                      </span>
                    </td>
                    <td data-role="rates">
                      {product.rates === null ? (
                        <span className="admin-empty-cell">يُضبط مع أول سعر</span>
                      ) : (
                        <span className="stack" style={{ gap: 'var(--space-1)' }}>
                          {(
                            [
                              ['negative', 'غير موجود', product.rates.negativePct],
                              ['cached', 'نتيجة مخزّنة', product.rates.cachePct],
                            ] as const
                          ).map(([field, label, value]) => (
                            <span
                              key={field}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--space-1)',
                              }}
                            >
                              <span className="faint">{label}</span>
                              <span className="admin-price-field">
                                <Input
                                  form={PRICING_FORM}
                                  name={`${field}:${product.productCode}`}
                                  defaultValue={ratePctField(value)}
                                  inputMode="numeric"
                                  aria-label={`نسبة ${label} من سعر ${product.nameAr} بالمئة`}
                                  disabled={!view.canEditPricing}
                                  ltr
                                />
                              </span>
                              <span className="faint">%</span>
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td data-role="customer-pays">
                      {product.priceWithVatHalalas === null ? (
                        <span className="admin-empty-cell">·</span>
                      ) : (
                        <span className="stack" style={{ gap: 0 }}>
                          <Ltr>{riyals(product.priceWithVatHalalas)}</Ltr>
                          {view.vat.registered ? (
                            <span className="admin-sub">شامل الضريبة</span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td
                      className="admin-margin"
                      data-tone={
                        product.marginPct !== null && product.marginPct < view.minimumMarginPct
                          ? 'thin'
                          : undefined
                      }
                    >
                      <span className="stack" style={{ gap: 0 }}>
                        <Ltr>{product.marginPct === null ? '·' : `${product.marginPct}%`}</Ltr>
                        {/* The percentage hides the size. Both, because a 40% margin on two
                            riyals and on two hundred are different businesses. */}
                        {product.marginHalalas === null ? null : (
                          <span className="admin-sub" data-role="margin-riyals">
                            <Ltr>{riyals(product.marginHalalas)}</Ltr> للعملية
                          </span>
                        )}
                      </span>
                    </td>
                    <td>
                      <Ltr>{count(product.runs30)}</Ltr>
                    </td>
                    <td>
                      <StatusCell product={product} editable={view.canEditPricing} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <div className="admin-offers">
        <Card role="bundles" labelledBy="bundles-title">
          <h2 className="card-title admin-offer-title" id="bundles-title">
            حزم الرصيد مسبقة الدفع
          </h2>
          <p className="admin-card-note">تُشترى مرة واحدة وتُصرف على أي تحقق مهما كان سعره</p>
          {view.bundles.length === 0 ? (
            <p className="admin-empty">لا حزمة معروضة للبيع.</p>
          ) : (
            <ul className="admin-offer-list">
              {view.bundles.map((bundle) => (
                <li key={bundle.code} className="admin-offer" data-role="bundle">
                  <span className="admin-offer-line">
                    <span>
                      {operationsAr(bundle.operations)}{' '}
                      {bundle.discountPct === null ? null : (
                        <span className="admin-discount">
                          <Ltr>{discountAr(bundle.discountPct)}</Ltr>
                        </span>
                      )}
                    </span>
                    <span className="admin-offer-end">
                      <Ltr>{sar(bundle.priceHalalas)}</Ltr>
                      {view.canEditPricing ? (
                        <form action={actions.retireBundle} className="admin-inline-form">
                          <input type="hidden" name="code" value={bundle.code} />
                          <IconButton
                            type="submit"
                            icon="x"
                            label={`إيقاف بيع حزمة ${operationsAr(bundle.operations)}`}
                          />
                        </form>
                      ) : null}
                    </span>
                  </span>
                  {/* The price of one operation: what the constraint is written against, and
                      what makes two bundles comparable at all. */}
                  <span className="admin-offer-terms" data-role="bundle-terms">
                    {bundleTermsAr(bundle)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {view.canEditPricing ? (
            <BundleDialog action={actions.addBundle} defined={view.definedBundles} />
          ) : null}
        </Card>

        <Card role="plans" labelledBy="plans-title">
          <h2 className="card-title admin-offer-title" id="plans-title">
            الاشتراكات
          </h2>
          <p className="admin-card-note">حد شهري للعمليات مع سعر تجاوز</p>
          {view.plans.length === 0 ? (
            <p className="admin-empty">لا باقة اشتراك بعد.</p>
          ) : (
            <ul className="admin-offer-list">
              {view.plans.map((plan) => {
                const lines = planLinesAr(plan);
                return (
                  <li key={plan.code} className="admin-offer" data-role="plan">
                    <span className="admin-offer-line">
                      <Link
                        href={`/operator/pricing/plans#${plan.code}`}
                        className="admin-offer-link"
                      >
                        {plan.nameAr}
                      </Link>
                      <span className="admin-offer-end">
                        <span>{lines.price}</span>
                        {view.canEditPricing ? (
                          <PlanTermsDialog action={actions.setPlanTerms} plan={plan} />
                        ) : null}
                      </span>
                    </span>
                    <span className="admin-offer-terms">{lines.terms}</span>
                    {/* The free re-verification window, the term and the setup fee: money
                        decided by columns that were literals in the code until now. */}
                    <span className="admin-offer-terms" data-role="plan-commitment">
                      {lines.commitment}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {view.canEditPricing ? <AddPlanDialog action={actions.addPlan} /> : null}
        </Card>

        <Card role="special-prices" labelledBy="special-prices-title">
          <h2 className="card-title admin-offer-title" id="special-prices-title">
            أسعار خاصة لمشترك
          </h2>
          <p className="admin-card-note">تتجاوز الأسعار العامة عند وجودها</p>
          {view.specialPrices.length === 0 ? (
            <p className="admin-empty">لا سعر خاص لأي مشترك.</p>
          ) : (
            <ul className="admin-offer-list">
              {view.specialPrices.map((special) => (
                <li key={special.tenantId} className="admin-offer" data-role="special-price">
                  <Link
                    href={`/operator/subscribers/${special.tenantId}`}
                    className="admin-offer-link"
                  >
                    {special.legalName}
                  </Link>
                  <span className="admin-offer-terms">{specialLineAr(special)}</span>
                </li>
              ))}
            </ul>
          )}
          {view.canEditPricing ? (
            <SpecialPriceDialog
              action={actions.setSpecialPrice}
              subscribers={view.subscribers}
              products={view.products
                .filter((product) => product.availability === 'AVAILABLE')
                .map((product) => ({ code: product.productCode, nameAr: product.nameAr }))}
            />
          ) : null}
        </Card>
      </div>

      <VatPanel
        periods={view.vatPeriods}
        today={view.today}
        canEdit={view.canEditPricing}
        action={actions.setVat}
      />

      <VerificationSettings
        settings={view.settings}
        sections={view.sections}
        formId={PRICING_FORM}
        editable={view.canEditSettings}
      />
    </div>
  );
}
