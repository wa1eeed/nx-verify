import { count } from '../../../../components/format';

/**
 * What the checkout screen says when an order could not be placed (ADR-187).
 *
 * The screen drew a total and a button, and the action behind the button called straight into
 * the domain with nothing around it. Two ordinary things throw there: an amount the domain
 * refuses, and a bundle the panel withdrew between the moment this screen was opened and the
 * moment it was submitted. Both replaced the entire portal with the framework's default error
 * page, in English, at the exact moment a subscriber pressed «أرسل الطلب», with no way to tell
 * whether the money had been asked for or not.
 *
 * So a refusal comes back to the same screen, still describing the same purchase, with one
 * sentence about what happened to the order. Each sentence says what was not done, because
 * that is the question somebody who just pressed a buy button is asking.
 */

/**
 * The range the domain will take, in riyals.
 *
 * It mirrors the guard inside `requestTopUp` (packages/core/src/billing/topups.ts), and the
 * test beside this file asserts the two agree by putting each end of the range through the
 * domain itself. The screen guarded the bottom of the range and not the top, so an address
 * asking for a hundred million riyals drew a total, a tax line and a button that could only
 * throw.
 */
export const MIN_TOPUP_RIYALS = 100;
export const MAX_TOPUP_RIYALS = 10_000_000;

export type CheckoutRefusal = 'amount' | 'sold-out' | 'failed' | 'unknown';

const REFUSALS: Record<CheckoutRefusal, { text: string; role: string }> = {
  amount: {
    text: `المبلغ خارج المدى المسموح، فلم يُرسل الطلب. اكتب مبلغاً بين ${count(MIN_TOPUP_RIYALS)} و${count(MAX_TOPUP_RIYALS)} ريال.`,
    role: 'checkout-amount',
  },
  'sold-out': {
    text: 'لم تعد هذه الحزمة معروضة للبيع، فلم يُرسل الطلب ولم يُخصم شيء. اختر حزمة أخرى من «الباقة والرصيد».',
    role: 'checkout-sold-out',
  },
  failed: {
    // True by construction: the request is written inside one transaction, so a failure
    // anywhere in it leaves no row and no reference behind (packages/db, withTenant).
    text: 'لم يصل طلبك إلينا ولم يُخصم شيء. أعد المحاولة، وإن تكرر الخطأ فتواصل مع الدعم.',
    role: 'checkout-failed',
  },
  unknown: {
    text: 'لم نتعرّف على ما تريد شراءه. ارجع إلى «الباقة والرصيد» واختر حزمة أو أدخل مبلغاً.',
    role: 'checkout-nothing',
  },
};

/** The sentence for a refusal, or null for anything this screen does not recognise. */
export function checkoutRefusal(
  reason: string | null | undefined,
): { text: string; role: string } | null {
  return reason === null || reason === undefined
    ? null
    : (REFUSALS[reason as CheckoutRefusal] ?? null);
}

/** Whether an amount in riyals is one the domain will accept. */
export function sellableAmount(riyals: number): boolean {
  return Number.isFinite(riyals) && riyals >= MIN_TOPUP_RIYALS && riyals <= MAX_TOPUP_RIYALS;
}
