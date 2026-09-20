import type { TenantTransaction } from '@nx-verify/db';
import { resolvePrice } from './price-book.js';

/**
 * What a run is charged when it is not a plain success, in the words a subscriber reads.
 *
 * The two shares sit on the price row and compute.ts applies them: a NOT_FOUND answer is
 * charged `negative_pct` of the step's share, because the authority did answer, and an
 * answer served from cache `cache_pct`. Only a technical failure and a skipped step earn
 * nothing at all, and that is fixed in code rather than set per price row (guard 04).
 *
 * This exists because both subscriber screens said «العمليات الفاشلة لا تُحسب», which reads
 * as a promise that anything short of a success is free. On the default shares a NOT_FOUND
 * costs half the price and a cached answer all of it, so that sentence described money the
 * subscriber had been told would not be taken. A screen may not state a share it has not
 * read, so the shares are resolved here, from the price row in force for that subscriber,
 * and the wording is derived from them rather than written out beside them.
 */
export interface ChargedOutcomes {
  productCode: string;
  /** Share of the price a NOT_FOUND answer is charged at, 0 to 1. */
  notFoundPct: number;
  /** Share a cached answer is charged at, 0 to 1. */
  cachedPct: number;
}

export interface ChargedOutcomesOptions {
  /** Reads the shares in force at this instant, so a screen and a run agree on them. */
  asOf?: Date;
}

/**
 * The shares in force for this subscriber, per product.
 *
 * Through resolvePrice, so the precedence is the one a run is priced by: a contract price,
 * then the subscriber's own, then the list. A product with no price in force is absent from
 * the map rather than carried at a default, because a share nobody set is a share no screen
 * may print.
 */
export async function chargedOutcomes(
  tx: TenantTransaction,
  productCodes: readonly string[],
  options: ChargedOutcomesOptions = {},
): Promise<Map<string, ChargedOutcomes>> {
  const shares = new Map<string, ChargedOutcomes>();

  for (const productCode of new Set(productCodes)) {
    const price = await resolvePrice(
      tx,
      productCode,
      options.asOf === undefined ? {} : { asOf: options.asOf },
    ).catch(() => null);
    if (price === null) {
      continue;
    }
    shares.set(productCode, {
      productCode,
      notFoundPct: price.negativePct,
      cachedPct: price.cachePct,
    });
  }

  return shares;
}

/** One share, said rather than printed as a ratio. */
export function chargedShareAr(share: number): string {
  if (share <= 0) {
    return 'لا تُحسب';
  }
  if (share >= 1) {
    return 'تُحسب كاملة';
  }
  return `تُحسب بـ${Math.round(share * 100)}% من السعر`;
}

/**
 * The half no price row can change: compute.ts charges neither, whatever the shares say.
 *
 * Kept apart from the shares so a screen that has not read them can still say this much
 * rather than fall silent or promise more than it knows.
 */
export const NOT_CHARGED_AR = 'الفشل التقني والخطوة المتخطاة لا تُحسبان';

/**
 * What a screen may say when it cannot name the shares: the half no price row can change,
 * and where the rest is written.
 *
 * It belongs beside the shares and not beside each screen. Two screens spelled this sentence
 * out for themselves, letter for letter, which is one rule in two wordings and precisely the
 * fault ADR-170 exists to remove: the day «أسعار المنتجات» is renamed, one of the two copies
 * starts pointing at a screen that is not there (ADR-188).
 */
export const OTHER_SHARES_AR = `${NOT_CHARGED_AR}، وما تُحسب به الحالات الأخرى في «أسعار المنتجات»`;

/** The whole of it, in one sentence, from the shares in force. */
export function chargedOutcomesSentenceAr(shares: ChargedOutcomes): string {
  return (
    `نتيجة «غير موجود» ${chargedShareAr(shares.notFoundPct)}` +
    `، والنتيجة المخزّنة ${chargedShareAr(shares.cachedPct)}` +
    `، و${NOT_CHARGED_AR}`
  );
}
