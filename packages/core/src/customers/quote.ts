import type { TenantTransaction } from '@nx-verify/db';
import { resolveEntitlement, type EntitlementRefusal } from '../billing/entitlements.js';
import { resolvePrice } from '../billing/price-book.js';
import { getWallet } from '../billing/wallet.js';

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
  QUOTA_EXHAUSTED: 'استُنفدت حصتها لهذه الدورة',
  CAPACITY_EXHAUSTED: 'استُنفدت سعة الباقة',
};

export interface CheckQuote {
  productCode: string;
  allowed: boolean;
  refusalAr: string | null;
  /** Excluding VAT. Null when no price is in force, which the run itself would refuse. */
  unitPriceHalalas: number | null;
}

export interface ChecksQuote {
  lines: CheckQuote[];
  /** Operations left in the package this term. Null when the plan sells no capacity. */
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
      lines.push({ productCode, allowed: false, refusalAr: 'غير متاحة', unitPriceHalalas: null });
      continue;
    }
    capacityRemaining = entitlement.capacityRemaining;
    let unitPriceHalalas = entitlement.unitPriceHalalas;
    if (unitPriceHalalas === null) {
      unitPriceHalalas = await resolvePrice(tx, productCode)
        .then((price) => price.unitPrice)
        .catch(() => null);
    }
    lines.push({
      productCode,
      allowed: entitlement.allowed,
      refusalAr: entitlement.refusal ? REFUSALS[entitlement.refusal] : null,
      unitPriceHalalas,
    });
  }

  const wallet = await getWallet(tx).catch(() => null);
  return { lines, capacityRemaining, walletAvailableHalalas: wallet?.available ?? 0 };
}
