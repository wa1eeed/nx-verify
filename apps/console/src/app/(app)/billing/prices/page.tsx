import type { ReactElement } from 'react';
import { NoAccess } from '../../../../components/no-access';
import {
  KIND_LABELS,
  NOT_CHARGED_AR,
  SECTION_TITLES,
  chargedOutcomes,
  chargedShareAr,
  getPreferences,
  listChecks,
  quoteChecks,
  vatInForce,
  withVat,
} from '@nx-verify/core';
import { PageHeader } from '../../../../components/page-header';
import { SectionTabs } from '../../../../components/section-tabs';
import { BILLING_TABS, visible } from '../../../../components/nav';
import {
  Card,
  CardTitle,
  Checkbox,
  Ltr,
  StateTag,
  SubmitButton,
  Table,
  Th,
} from '../../../../components/ui';
import { actingUser, query } from '../../../../lib/context';
import { setShowPricesAction } from './actions';

/** Never prerendered: this subscriber's own prices and package. */
export const dynamic = 'force-dynamic';

/**
 * What each verification costs this subscriber (handoff screen 00, «أسعار المنتجات»).
 *
 * The price that applies to them, which is a special price when one was agreed and the
 * public one otherwise, stored before VAT and shown with it (CLAUDE.md). A check the
 * package covers says so instead of a price, and a check that cannot run says why.
 */

const RIYALS = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default async function PricesPage(): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('wallet.read')) {
    return <NoAccess needs="wallet.read" />;
  }
  const data = await query(async (tx) => {
    const checks = await listChecks(tx);
    const quote = await quoteChecks(
      tx,
      checks.map((check) => check.productCode),
    );
    return {
      checks,
      quote,
      // What each product charges when the answer is not a plain success, read from the
      // price row in force rather than stated once in a subtitle: this is the figure that
      // surprises a subscriber in an invoice, and it is set per product (ADR-170).
      shares: await chargedOutcomes(
        tx,
        checks.map((check) => check.productCode),
      ),
      preferences: await getPreferences(tx),
      // The rule of today, not a rate assumed at build time: while the platform is not
      // registered nothing is added, and the column says «ما تدفعه» rather than claiming a
      // tax line that is not due (ADR-157).
      vat: await vatInForce(tx),
    };
  });
  const vat = data.vat;

  const lineOf = new Map(data.quote.lines.map((line) => [line.productCode, line]));
  const fromPackage = data.quote.capacityRemaining !== null && data.quote.capacityRemaining > 0;

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <SectionTabs
        tabs={visible(BILLING_TABS, actor.capabilities)}
        current="/billing/prices"
        label="أقسام الاشتراك والرصيد"
      />
      {/*
        The subtitle used to read «العمليات الفاشلة لا تُحسب», and that is not what happens:
        an authority that answers «لا يوجد» is an answer, charged at the share on the price
        row, and a cached answer at its own share. Only the two below earn nothing, so only
        they are stated here; what each product charges in the other cases is a column,
        because it differs per product (ADR-170).
      */}
      <PageHeader
        title="أسعار المنتجات"
        subtitle={`السعر بالريال لعملية ناجحة كاملة · ${NOT_CHARGED_AR}`}
      />

      <Card label="أسعار منتجات التحقق">
        <Table label="أسعار منتجات التحقق">
          <thead>
            <tr>
              <Th>المنتج</Th>
              <Th>القسم</Th>
              <Th>ينطبق على</Th>
              <Th>السعر</Th>
              <Th>{vat.registered ? 'شامل الضريبة' : 'ما تدفعه'}</Th>
              <Th>في الحالات الأخرى</Th>
              <Th>الحالة</Th>
            </tr>
          </thead>
          <tbody>
            {data.checks.map((check) => {
              const line = lineOf.get(check.productCode);
              const price = line?.unitPriceHalalas ?? null;
              const shares = data.shares.get(check.productCode);
              return (
                <tr key={check.productCode} data-check={check.productCode}>
                  <td>{check.nameAr}</td>
                  <td>{SECTION_TITLES[check.section]}</td>
                  <td>{check.appliesTo.map((kind) => KIND_LABELS[kind]).join('، ')}</td>
                  <td>
                    {fromPackage ? (
                      'من الباقة'
                    ) : price === null ? (
                      '·'
                    ) : (
                      <>
                        <Ltr>{RIYALS.format(price / 100)}</Ltr> ر.س
                      </>
                    )}
                  </td>
                  <td>
                    {fromPackage || price === null ? (
                      '·'
                    ) : (
                      <>
                        <Ltr>{RIYALS.format(withVat(price, vat).grossHalalas / 100)}</Ltr> ر.س
                      </>
                    )}
                  </td>
                  <td data-role="other-outcomes">
                    {fromPackage || shares === undefined ? (
                      /*
                       * Nothing, for the same reason the two columns before it say nothing.
                       *
                       * A share is a share of the riyal price, and while the package pays there
                       * is no riyal price on this row: the run comes out of the capacity, one
                       * operation whatever the authority answered. «تُحسب بـ50% من السعر» beside
                       * «من الباقة» names a fraction of a figure the row does not show and the
                       * subscriber is not charged, which is the same kind of sentence this
                       * column was added to remove (ADR-170). And with no price row at all no
                       * share was ever set, so the default is not printed as if someone chose it.
                       */
                      '·'
                    ) : (
                      <span className="stack" style={{ gap: 'var(--space-1)' }}>
                        <span>
                          <span className="faint">نتيجة «غير موجود» </span>
                          {chargedShareAr(shares.notFoundPct)}
                        </span>
                        <span>
                          <span className="faint">نتيجة مخزّنة </span>
                          {chargedShareAr(shares.cachedPct)}
                        </span>
                      </span>
                    )}
                  </td>
                  <td>
                    {check.availability !== 'AVAILABLE' ? (
                      <StateTag state="PENDING">قريباً</StateTag>
                    ) : line !== undefined && !line.allowed ? (
                      <StateTag state="NOT_APPLICABLE">{line.refusalAr ?? 'غير متاحة'}</StateTag>
                    ) : (
                      <StateTag state="ACTIVE">متاح</StateTag>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {actor.can('prices.manage') ? (
        <Card label="إظهار الأسعار" role="price-visibility">
          <form action={setShowPricesAction} className="stack" style={{ gap: 'var(--space-3)' }}>
            <CardTitle as="h2">إظهار الأسعار</CardTitle>
            <Checkbox name="show_prices" defaultChecked={data.preferences.showPrices}>
              إظهار سعر كل منتج وإجمالي الطلب في شاشات التحقق لمستخدمي مساحة العمل
            </Checkbox>
            <p className="faint" style={{ margin: 0 }}>
              إخفاء الأسعار لا يغيّر ما يُخصم: الخصم يتبع نتيجة كل عملية كما في الجدول أعلاه.
            </p>
            <div>
              <SubmitButton pendingLabel="جارٍ الحفظ" data-role="save-price-visibility">
                حفظ
              </SubmitButton>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
