import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AvailableBundle } from '@nx-verify/core';
import { Checkout } from '../src/components/checkout';
import { checkoutLineAr } from '../src/app/(app)/billing/checkout/line';

/**
 * The line the buyer reads in the last moment before committing (ADR-181).
 *
 * This screen wrote its own sentence out of the raw figures: «2000 عملية، صالحة 1 شهراً»,
 * with no grouping, the wrong Arabic for one month, and no price of an operation, which is
 * the one figure that says whether the bundle is worth buying. All three had been solved one
 * screen back on the offer card (ADR-171), and the screen that takes the money was the one
 * still saying it badly.
 *
 * Asserted through the very function the page calls, not through a hand copy of what it is
 * believed to pass: the first version of this file built the line itself out of the offer
 * card's helper, so every rendering assertion in it passed against the page it was written to
 * fix, and only a regular expression over the page's source text failed.
 */

const bundle = (over: Partial<AvailableBundle> = {}): AvailableBundle => ({
  code: 'BUNDLE_2000',
  operations: 2_000,
  priceHalalas: 4_000_000,
  validityMonths: 12,
  perOperationHalalas: 2_000,
  discount: { pct: 8, againstOperations: 500 },
  ...over,
});

/** The line the page builds, rendered by the component the page renders. */
const checkout = (offer: AvailableBundle): string =>
  renderToStaticMarkup(
    <Checkout
      line={{
        ...checkoutLineAr(offer),
        netHalalas: offer.priceHalalas,
        vatHalalas: 0,
        grossHalalas: offer.priceHalalas,
        taxed: false,
      }}
      bank={{ accountName: 'NX', bankName: 'مصرف', iban: null, note: null }}
      bundleCode={offer.code}
      amountHalalas={null}
      action={async () => {}}
    />,
  );

describe('what the buyer is told a bundle is, on the screen that takes the money', () => {
  it('names the price of one operation, which is what makes two bundles comparable', () => {
    expect(checkout(bundle())).toContain('سعر العملية 20.00 ر.س');
  });

  it('groups the thousands rather than printing a bare 2000', () => {
    const line = checkoutLineAr(bundle());
    // The count is said once, in the title, with its separator. The terms carried a second,
    // ungrouped «2000» beside it, which is the figure this asserts is gone: a rendering
    // assertion for «2,000» alone passes against the old line too, because the title always
    // grouped it.
    expect(line.titleAr).toContain('2,000');
    expect(line.detailAr).not.toContain('2000');
    expect(checkout(bundle())).toContain('2,000');
  });

  it('reads a one month bundle as a month, not as «1 شهراً»', () => {
    const html = checkout(bundle({ code: 'BUNDLE_100', operations: 100, validityMonths: 1 }));
    expect(html).toContain('صالحة شهر واحد');
    expect(html).not.toContain('1 شهراً');
  });

  it('says what the discount is measured against, or says nothing about one', () => {
    expect(checkout(bundle())).toContain('أقل 8% من سعر العملية في حزمة 500 عملية');
    expect(checkout(bundle({ discount: null }))).not.toContain('أقل');
  });

  it('says the same of an amount of riyals, which buys no operations at all', () => {
    const line = checkoutLineAr(null);
    expect(line.titleAr).toBe('رصيد بالريال');
    expect(line.detailAr).toBe('يُضاف إلى محفظتك ويُصرف على عمليات التحقق بأسعارها المعروضة.');
  });

  it('is the line the page itself builds, not a second one written on this screen', () => {
    // The rendering above is only about the page while the page builds its line here. A
    // guard on the wiring, because that is the one step a render cannot reach: a page exports
    // nothing a test can call.
    const source = readFileSync(
      new URL('../src/app/(app)/billing/checkout/page.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('checkoutLineAr(bundle ?? null)');
    expect(source).not.toContain('${bundle.operations}');
    expect(source).not.toContain('${bundle.validityMonths}');
  });
});
