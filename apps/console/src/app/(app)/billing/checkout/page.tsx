import type { ReactElement } from 'react';
import {
  getPlatformSettings,
  listAvailableBundles,
  vatInForce,
  withVat,
} from '@nx-verify/core';
import { Checkout, CheckoutDone, type CheckoutBank } from '../../../../components/checkout';
import { NoAccess } from '../../../../components/no-access';
import { PageHeader } from '../../../../components/page-header';
import { SectionTabs } from '../../../../components/section-tabs';
import { BILLING_TABS, visible } from '../../../../components/nav';
import { actingUser, query } from '../../../../lib/context';
import { bundleLabelOf } from '../../../../components/topup';
import { placeOrderAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * The step between choosing and paying (ADR-158).
 *
 * Reached from a bundle on the balance screen, or from an amount of credit. It shows what is
 * being bought, what it totals under today's tax rule, how to pay, and the account to pay
 * into, before there is anything to press. The screen it replaced asked for a number and
 * revealed the bank details afterwards, which put both halves of the decision behind the
 * commitment.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('wallet.topup')) {
    return <NoAccess needs="wallet.topup" />;
  }

  const params = await searchParams;
  const one = (key: string): string | null => {
    const value = params[key];
    return typeof value === 'string' ? value : null;
  };

  const bundleCode = one('bundle');
  const amountRiyals = Number(one('amount') ?? '');
  const reference = one('ref');

  const data = await query(async (tx) => ({
    settings: await getPlatformSettings(tx),
    vat: await vatInForce(tx),
    bundles: bundleCode === null ? [] : await listAvailableBundles(tx),
  }));

  const bank: CheckoutBank = {
    accountName: data.settings.bankAccountName,
    bankName: data.settings.bankName,
    iban: data.settings.bankIban,
    note: data.settings.transferNote,
  };

  const frame = (children: ReactElement): ReactElement => (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <SectionTabs
        tabs={visible(BILLING_TABS, actor.capabilities)}
        current="/billing"
        label="أقسام الاشتراك والرصيد"
      />
      {children}
    </div>
  );

  // Straight after the request: one reference, as large as the screen allows.
  if (reference !== null) {
    const gross = Number(one('total') ?? '0');
    return frame(
      <>
        <PageHeader title="أرسلنا طلبك" subtitle="حوّل المبلغ بالرقم المرجعي، ونؤكّده عند وصوله." />
        <CheckoutDone reference={reference} grossHalalas={gross} bank={bank} />
      </>,
    );
  }

  const bundle =
    bundleCode === null ? null : data.bundles.find((offer) => offer.code === bundleCode);

  // Neither a bundle we sell nor a sane amount: the screen says so rather than rendering a
  // purchase of nothing.
  const netHalalas =
    bundle !== null && bundle !== undefined
      ? bundle.priceHalalas
      : Number.isFinite(amountRiyals) && amountRiyals >= 100
        ? Math.round(amountRiyals * 100)
        : null;

  if (netHalalas === null) {
    return frame(
      <>
        <PageHeader title="شراء رصيد" subtitle="اختر حزمة أو مبلغاً من شاشة الرصيد." />
        <p className="notice notice-refused" data-role="checkout-nothing">
          لم نتعرّف على ما تريد شراءه. ارجع إلى «الباقة والرصيد» واختر حزمة أو أدخل مبلغاً.
        </p>
      </>,
    );
  }

  const taxed = withVat(netHalalas, data.vat);

  return frame(
    <>
      <PageHeader
        title="إتمام الشراء"
        subtitle="راجع ما ستشتريه ووسيلة الدفع وبيانات الحساب قبل إرسال الطلب."
      />
      <Checkout
        line={{
          titleAr:
            bundle === null || bundle === undefined
              ? 'رصيد بالريال'
              : (bundleLabelOf(bundle.code) ?? 'حزمة رصيد'),
          detailAr:
            bundle === null || bundle === undefined
              ? 'يُضاف إلى محفظتك ويُصرف على عمليات التحقق بأسعارها المعروضة.'
              : `${bundle.operations} عملية، صالحة ${bundle.validityMonths} شهراً.`,
          netHalalas: taxed.netHalalas,
          vatHalalas: taxed.vatHalalas,
          grossHalalas: taxed.grossHalalas,
          taxed: data.vat.registered,
        }}
        bank={bank}
        bundleCode={bundle?.code ?? null}
        amountHalalas={bundle === null || bundle === undefined ? netHalalas : null}
        action={placeOrderAction}
      />
    </>,
  );
}
