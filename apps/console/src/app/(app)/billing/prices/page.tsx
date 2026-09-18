import type { ReactElement } from 'react';
import { NoAccess } from '../../../../components/no-access';
import {
  KIND_LABELS,
  SECTION_TITLES,
  getPreferences,
  listChecks,
  quoteChecks,
  vatOn,
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
    return { checks, quote, preferences: await getPreferences(tx) };
  });

  const lineOf = new Map(data.quote.lines.map((line) => [line.productCode, line]));
  const fromPackage = data.quote.capacityRemaining !== null && data.quote.capacityRemaining > 0;

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <SectionTabs tabs={visible(BILLING_TABS, actor.capabilities)} current="/billing/prices" label="أقسام الاشتراك والرصيد" />
      <PageHeader
        title="أسعار المنتجات"
        subtitle="السعر بالريال لكل عملية ناجحة · العمليات الفاشلة لا تُحسب"
      />

      <Card label="أسعار منتجات التحقق">
        <Table label="أسعار منتجات التحقق">
          <thead>
            <tr>
              <Th>المنتج</Th>
              <Th>القسم</Th>
              <Th>ينطبق على</Th>
              <Th>قبل الضريبة</Th>
              <Th>مع الضريبة</Th>
              <Th>الحالة</Th>
            </tr>
          </thead>
          <tbody>
            {data.checks.map((check) => {
              const line = lineOf.get(check.productCode);
              const price = line?.unitPriceHalalas ?? null;
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
                        <Ltr>{RIYALS.format((price + vatOn(price)) / 100)}</Ltr> ر.س
                      </>
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
              إخفاء الأسعار لا يغيّر ما يُخصم: يُخصم فقط عند نجاح العملية.
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
