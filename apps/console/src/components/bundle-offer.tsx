import type { ReactElement } from 'react';
import type { AvailableBundle, BundleBalance } from '@nx-verify/core';
import { Card } from './ui/card';
import { Ltr } from './ui/ltr';
import { ButtonLink } from './ui/button';
import { count, dateAr, riyals } from './format';
import { discountAr, monthsAr, operationsAr, sar } from './admin-pricing/model';

/**
 * Credit bundles, from the subscriber's side (PLAN.md, decision 3).
 *
 * What the workspace still holds in bundles, and the bundles on sale. Asking for one issues a
 * transfer reference for its price, as asking for credit does; the operations are granted
 * when the transfer arrives. Prices are before VAT, and the transfer screen shows the amount
 * with it.
 */

/**
 * What one operation costs, how long the bundle lasts, and what the «−8%» is measured
 * against (ADR-171).
 *
 * The card used to show a count, a whole price and a bare percent. The price of an operation
 * is the only figure that makes two bundles comparable, and it was the one figure missing;
 * the percent was measured against the first bundle in the list and named no basis, so it
 * read as a discount off what a check ordinarily costs, which it never was.
 */
export function offerTermsAr(bundle: AvailableBundle): string {
  const parts = [
    `سعر العملية ${riyals(bundle.perOperationHalalas)} ر.س`,
    `صالحة ${monthsAr(bundle.validityMonths)} من تأكيد الحوالة`,
  ];
  if (bundle.discount !== null) {
    parts.push(
      `أقل ${bundle.discount.pct}% من سعر العملية في حزمة ${operationsAr(
        bundle.discount.againstOperations,
      )}`,
    );
  }
  return parts.join(' · ');
}

export function BundleOffer({
  balance,
  bundles,
  canBuy = true,
}: {
  balance: Pick<BundleBalance, 'operations' | 'nextExpiry'>;
  bundles: readonly AvailableBundle[];
  /** False for somebody who may see the balance but not order against it. */
  canBuy?: boolean;
}): ReactElement {
  return (
    <Card role="bundle-offer" labelledBy="bundle-offer-title">
      <h2 className="card-title admin-card-title" id="bundle-offer-title">
        حزم الرصيد مسبقة الدفع
      </h2>
      <p className="admin-card-note" data-role="bundle-balance">
        {balance.operations === 0 || balance.nextExpiry === null ? (
          'لا عمليات في حزم لديك الآن. تُصرف عمليات الحزمة بعد عمليات الباقة وقبل الرصيد بالريال.'
        ) : (
          <>
            لديك <Ltr>{count(balance.operations)}</Ltr> عملية في الحزم، وأقربها ينتهي في{' '}
            {dateAr(balance.nextExpiry)}.
          </>
        )}
      </p>
      {bundles.length === 0 ? (
        <p className="admin-empty">لا حزمة معروضة للبيع الآن.</p>
      ) : (
        <ul className="admin-offer-list">
          {bundles.map((bundle) => (
            <li key={bundle.code} className="admin-offer" data-role="bundle">
              <span className="admin-offer-line">
                <span>
                  {operationsAr(bundle.operations)}{' '}
                  {bundle.discount === null ? null : (
                    <span className="admin-discount">
                      <Ltr>{discountAr(bundle.discount.pct)}</Ltr>
                    </span>
                  )}
                </span>
                <span className="admin-offer-end">
                  <Ltr>{sar(bundle.priceHalalas)}</Ltr>
                  {/*
                    A link to the checkout, not a submit. Choosing a bundle is not the same
                    act as ordering one: the total, the tax if any is due, and the account to
                    transfer to all belong before the commitment, not after it (ADR-158).
                  */}
                  {canBuy ? (
                    <ButtonLink
                      href={`/billing/checkout?bundle=${encodeURIComponent(bundle.code)}`}
                      data-role="request-bundle"
                    >
                      اشترِ الحزمة
                    </ButtonLink>
                  ) : null}
                </span>
              </span>
              {/* The price of one operation first: the figure the whole price and the
                  percent above it both come from. */}
              <span className="admin-offer-terms" data-role="bundle-terms">
                {offerTermsAr(bundle)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
