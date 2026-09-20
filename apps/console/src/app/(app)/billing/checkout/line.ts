import type { AvailableBundle } from '@nx-verify/core';
import { offerTermsAr } from '../../../../components/bundle-offer';
import { bundleLabelOf } from '../../../../components/topup';

/**
 * What the buyer is told they are buying, in the last moment before committing (ADR-181).
 *
 * Beside the page rather than inside it. A page exports nothing a test can call, so the
 * sentence written inside one is asserted by reading the file as text, which pins the spelling
 * of a call and not the words the buyer reads. Both screens that describe a bundle now reach
 * the same two lines through the same function, and a test renders the function rather than a
 * hand copy of what the page is believed to pass.
 *
 * The terms are the offer card's own sentence (`offerTermsAr`, ADR-171): the price of one
 * operation, how long the bundle lasts, and what its discount is measured against. The page
 * used to assemble its own out of the raw figures and got all three wrong.
 */
export function checkoutLineAr(bundle: AvailableBundle | null): {
  titleAr: string;
  detailAr: string;
} {
  if (bundle === null) {
    return {
      titleAr: 'رصيد بالريال',
      detailAr: 'يُضاف إلى محفظتك ويُصرف على عمليات التحقق بأسعارها المعروضة.',
    };
  }
  return { titleAr: bundleLabelOf(bundle.code) ?? 'حزمة رصيد', detailAr: offerTermsAr(bundle) };
}
