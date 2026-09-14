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
import { AddBundleDialog, AddPlanDialog, SpecialPriceDialog } from './dialogs';
import {
  bundlesLineAr,
  discountAr,
  lastChangeAr,
  operationsAr,
  planLinesAr,
  priceField,
  sar,
  specialLineAr,
} from './model';
import { VerificationSettings, type SectionsView } from './settings';

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
  bundles: readonly CreditBundle[];
  plans: readonly PlanSummary[];
  specialPrices: readonly SpecialPrice[];
  settings: Pick<
    PlatformSettings,
    'maxAttempts' | 'resultValidityDays' | 'nameMatchThresholdPct' | 'registryAlertDays'
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
  setSpecialPrice: Action;
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

      <Card variant="flush" role="price-table" labelledBy="price-table-title">
        <div className="admin-card-head">
          <h2 className="card-title admin-card-title" id="price-table-title">
            سعر كل منتج تحقق
          </h2>
          <p className="admin-card-note">
            السعر بالريال لكل عملية ناجحة · العمليات الفاشلة لا تُحسب
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
                  <Th>التكلفة</Th>
                  <Th>سعر البيع</Th>
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
                    <td>{product.nameAr}</td>
                    <td>
                      <Ltr>{riyals(product.costHalalas)}</Ltr>
                    </td>
                    <td>
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
                    </td>
                    <td
                      className="admin-margin"
                      data-tone={
                        product.marginPct !== null && product.marginPct < view.minimumMarginPct
                          ? 'thin'
                          : undefined
                      }
                    >
                      <Ltr>{product.marginPct === null ? '·' : `${product.marginPct}%`}</Ltr>
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
          <p className="admin-card-note">{bundlesLineAr(view.bundles)}</p>
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
                </li>
              ))}
            </ul>
          )}
          {view.canEditPricing ? <AddBundleDialog action={actions.addBundle} /> : null}
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
                      <a href={`/operator/pricing/plans#${plan.code}`} className="admin-offer-link">
                        {plan.nameAr}
                      </a>
                      <span>{lines.price}</span>
                    </span>
                    <span className="admin-offer-terms">{lines.terms}</span>
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
                  <a
                    href={`/operator/subscribers/${special.tenantId}`}
                    className="admin-offer-link"
                  >
                    {special.legalName}
                  </a>
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

      <VerificationSettings
        settings={view.settings}
        sections={view.sections}
        formId={PRICING_FORM}
        editable={view.canEditSettings}
      />
    </div>
  );
}
