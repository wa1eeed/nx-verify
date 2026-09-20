import type { TenantTransaction } from '@nx-verify/db';
import {
  ceilingUnitPrice,
  chargedUnitPrice,
  resolveEntitlement,
  type EntitlementRefusal,
} from '../billing/entitlements.js';
import { resolvePrice } from '../billing/price-book.js';
import { getWallet } from '../billing/wallet.js';
import { bundleBalance } from '../billing/bundles.js';

/**
 * What ticking these checks will cost, said before anyone presses verify.
 *
 * The owner's model is one button for several paid calls, and the one thing that makes
 * that safe is a sentence beside the button saying how many operations it will run and
 * whether they come out of the package or the balance. Nobody should learn the price of
 * a full verification from their statement.
 *
 * An estimate, and labelled as one: a manager check runs once per manager, and how many
 * managers a company has is only known once its registry record has been read.
 */

const REFUSALS: Readonly<Record<EntitlementRefusal, string>> = {
  NO_SUBSCRIPTION: 'لا توجد باقة مفعّلة',
  SUBSCRIPTION_INACTIVE: 'الاشتراك غير نشط',
  PRODUCT_NOT_IN_PACKAGE: 'غير مشمولة في باقتك',
  PRODUCT_DISABLED: 'معطّلة لمساحة عملك',
  MODULE_OFF: 'ضمن موديول غير مفعّل لمساحة عملك',
  QUOTA_EXHAUSTED: 'استُنفدت حصتها لهذه الدورة',
  CAPACITY_EXHAUSTED: 'استُنفدت سعة الباقة',
};

export interface CheckQuote {
  productCode: string;
  allowed: boolean;
  refusalAr: string | null;
  /** Excluding VAT. Null when no price is in force, which the run itself would refuse. */
  unitPriceHalalas: number | null;
  /**
   * The most one operation can be charged before the term's capacity is refilled, excluding
   * VAT. The same figure as above wherever the plan cannot reprice an excess run, and the
   * dearer of the two rates where it can.
   *
   * A screen that adds up several operations must add up this one. The subscriber's first few
   * operations come out of the capacity and the rest are charged past it at the plan's overage
   * rate, so a total built from the included rate is a number smaller than the hold the run
   * places (ADR-188).
   */
  ceilingUnitPriceHalalas: number | null;
}

export interface ChecksQuote {
  lines: CheckQuote[];
  /**
   * Operations that pay before the wallet does: what is left in the package this term and in
   * the subscriber's bundles. Null when neither sells any.
   */
  capacityRemaining: number | null;
  walletAvailableHalalas: number;
}

export async function quoteChecks(
  tx: TenantTransaction,
  productCodes: readonly string[],
): Promise<ChecksQuote> {
  const lines: CheckQuote[] = [];
  let capacityRemaining: number | null = null;

  for (const productCode of productCodes) {
    const entitlement = await resolveEntitlement(tx, productCode).catch(() => null);
    if (entitlement === null) {
      lines.push({
        productCode,
        allowed: false,
        refusalAr: 'غير متاحة',
        unitPriceHalalas: null,
        ceilingUnitPriceHalalas: null,
      });
      continue;
    }
    // The least of them, not the last of them: it was plain assignment inside the loop, so a
    // quote for three products reported the capacity of whichever happened to come last.
    capacityRemaining =
      entitlement.capacityRemaining === null
        ? capacityRemaining
        : capacityRemaining === null
          ? entitlement.capacityRemaining
          : Math.min(capacityRemaining, entitlement.capacityRemaining);
    const listPrice =
      entitlement.unitPriceHalalas === null
        ? await resolvePrice(tx, productCode)
            .then((price) => price.unitPrice)
            .catch(() => null)
        : entitlement.unitPriceHalalas;
    /*
     * The overage rate applies even when neither of the two prices above exists.
     *
     * It is the plan's answer to a question that only arises past the capacity, so it is
     * precisely the one price that can exist without a plan price and without a list price.
     * Falling through to null here showed a subscriber no price at all on the screen they read
     * before buying (ADR-168).
     */
    const basis = listPrice ?? entitlement.overageUnitPriceHalalas;
    const unitPriceHalalas = basis === null ? null : chargedUnitPrice(entitlement, basis);
    /*
     * The ceiling stands on the same basis, with one difference: the overage rate counts here
     * even while the capacity still has room, because the operations a screen is quoting for
     * can cross it. Which is also why it can be known when the price above is not, on a plan
     * whose only figure for this product is what an excess run costs.
     */
    const ceilingBasis = listPrice ?? entitlement.overageRateHalalas;
    lines.push({
      productCode,
      allowed: entitlement.allowed,
      refusalAr: entitlement.refusal ? REFUSALS[entitlement.refusal] : null,
      unitPriceHalalas,
      ceilingUnitPriceHalalas:
        ceilingBasis === null ? null : ceilingUnitPrice(entitlement, ceilingBasis),
    });
  }

  const wallet = await getWallet(tx).catch(() => null);
  const bundles = (await bundleBalance(tx)).operations;
  return {
    lines,
    capacityRemaining:
      capacityRemaining === null && bundles === 0 ? null : (capacityRemaining ?? 0) + bundles,
    walletAvailableHalalas: wallet?.available ?? 0,
  };
}
