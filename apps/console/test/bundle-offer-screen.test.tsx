import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AvailableBundle } from '@nx-verify/core';
import { BundleOffer, offerTermsAr } from '../src/components/bundle-offer';
import { bundleReplaceWarningAr } from '../src/components/admin-pricing/model';

/**
 * The bundle card a subscriber buys from (ADR-171).
 *
 * It showed a count, a whole price and a «−8%», and hid the one figure the buyer compares
 * everything by: what a single operation costs. The percent was measured against whichever
 * bundle came first in the list and named no basis at all, so it read as a discount off what
 * a check ordinarily costs, which it never was.
 */

const EM_DASH = String.fromCharCode(0x2014);

const SMALLEST: AvailableBundle = {
  code: 'BUNDLE_500',
  operations: 500,
  priceHalalas: 10_000_00,
  validityMonths: 12,
  perOperationHalalas: 20_00,
  discount: null,
};

const LARGER: AvailableBundle = {
  code: 'BUNDLE_2000',
  operations: 2000,
  priceHalalas: 36_800_00,
  validityMonths: 12,
  perOperationHalalas: 18_40,
  discount: { pct: 8, againstOperations: 500 },
};

function card(bundles: readonly AvailableBundle[], canBuy = true): string {
  return renderToStaticMarkup(
    <BundleOffer balance={{ operations: 0, nextExpiry: null }} bundles={bundles} canBuy={canBuy} />,
  );
}

describe('the bundle card', () => {
  it('says what one operation costs in every bundle on sale', () => {
    const markup = card([SMALLEST, LARGER]);
    expect(markup).toContain('سعر العملية 20.00 ر.س');
    expect(markup).toContain('سعر العملية 18.40 ر.س');
    // And the whole price and the term stay where they were.
    expect(markup).toContain('10,000 ر.س');
    expect(markup).toContain('صالحة 12 شهراً من تأكيد الحوالة');
  });

  it('names the bundle a discount was measured against, beside the percent', () => {
    const markup = card([SMALLEST, LARGER]);
    expect(markup).toContain('−8%');
    expect(markup).toContain('أقل 8% من سعر العملية في حزمة 500 عملية');
    // The smallest bundle is the basis, so it claims nothing for itself.
    expect(offerTermsAr(SMALLEST)).not.toContain('أقل');
    expect(markup).not.toContain(EM_DASH);
  });

  it('prints the percent the price came with, not one computed from the first bundle', () => {
    // The largest bundle first, as a caller ordering by price would pass it. The card used to
    // measure every bundle against `bundles[0]`, which here would have made the cheapest
    // operation on the list the basis and shown the smallest bundle as dearer.
    const markup = card([LARGER, SMALLEST]);
    expect(markup).toContain('أقل 8% من سعر العملية في حزمة 500 عملية');
    // One percent on the card, on the bundle that earned it, whatever the order.
    expect(markup.match(/−\d+%/g)).toEqual(['−8%']);
    expect(markup).not.toContain('أقل 9%');
  });

  it('says the truth when nothing is on sale, and still shows terms without a buy link', () => {
    expect(card([])).toContain('لا حزمة معروضة للبيع الآن.');
    const markup = card([SMALLEST], false);
    expect(markup).toContain('سعر العملية 20.00 ر.س');
    expect(markup).not.toContain('اشترِ الحزمة');
  });
});

describe('adding a bundle whose count is already taken', () => {
  it('says what is on sale now and what saving would change', () => {
    const warning = bundleReplaceWarningAr({
      operations: 500,
      priceHalalas: 10_000_00,
      validityMonths: 12,
      retired: false,
    });
    expect(warning).toContain('10,000 ر.س');
    expect(warning).toContain('سعر العملية 20.00 ر.س');
    expect(warning).toContain('12 شهراً');
    expect(warning).toContain('يستبدل');
    expect(warning).not.toContain(EM_DASH);
  });

  it('tells a retired bundle coming back on sale from a price being replaced', () => {
    const warning = bundleReplaceWarningAr({
      operations: 10_000,
      priceHalalas: 170_000_00,
      validityMonths: 24,
      retired: true,
    });
    expect(warning).toContain('موقوفة');
    expect(warning).toContain('يعيدها للبيع');
    expect(warning).toContain('سعر العملية 17.00 ر.س');
  });
});
