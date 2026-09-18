import type { ReactElement } from 'react';
import type { AvailableBundle, BundleBalance } from '@nx-verify/core';
import { Card } from './ui/card';
import { Ltr } from './ui/ltr';
import { ButtonLink } from './ui/button';
import { count, dateAr } from './format';
import { discountAr, monthsAr, operationsAr, sar } from './admin-pricing/model';

/**
 * Credit bundles, from the subscriber's side (PLAN.md, decision 3).
 *
 * What the workspace still holds in bundles, and the bundles on sale. Asking for one issues a
 * transfer reference for its price, as asking for credit does; the operations are granted
 * when the transfer arrives. Prices are before VAT, and the transfer screen shows the amount
 * with it.
 */

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
  const base = bundles[0] === undefined ? null : bundles[0].priceHalalas / bundles[0].operations;
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
          {bundles.map((bundle) => {
            const discount =
              base === null
                ? 0
                : Math.round((1 - bundle.priceHalalas / bundle.operations / base) * 100);
            return (
              <li key={bundle.code} className="admin-offer" data-role="bundle">
                <span className="admin-offer-line">
                  <span>
                    {operationsAr(bundle.operations)}{' '}
                    {discount > 0 ? (
                      <span className="admin-discount">
                        <Ltr>{discountAr(discount)}</Ltr>
                      </span>
                    ) : null}
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
                <span className="admin-offer-terms">
                  صالحة {monthsAr(bundle.validityMonths)} من تأكيد الحوالة
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
