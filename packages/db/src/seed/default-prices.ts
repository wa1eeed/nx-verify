import type { Queryable } from '../client.js';

/**
 * The default list price of each customer file check.
 *
 * A subscriber's plan names its own price for a check when it has one, and a price the
 * operator sets for one subscriber wins over both. This is what applies when neither does:
 * a sandbox, an enterprise commitment drawn down as credit, a new plan nobody priced yet.
 * Without it such a subscriber could open a customer file and verify nothing, because a
 * run without a price in force is refused before it starts.
 *
 * The same figures as the pay per transaction plan, excluding VAT like every price here.
 * Written on the owner role: the default list belongs to no subscriber, and the price
 * book's policy lets only that role write a row with no tenant (0011).
 */

export interface DefaultPrice {
  productCode: string;
  /** Riyals, as the column stores them. */
  unitPrice: string;
}

export const DEFAULT_CHECK_PRICES: readonly DefaultPrice[] = [
  { productCode: 'CR_FULL', unitPrice: '20.00' },
  { productCode: 'ARTICLES_OF_ASSOCIATION', unitPrice: '20.00' },
  { productCode: 'MANAGER_AUTHORITY', unitPrice: '20.00' },
  { productCode: 'NATIONAL_ADDRESS', unitPrice: '6.00' },
  { productCode: 'IBAN_VERIFICATION', unitPrice: '20.00' },
  { productCode: 'IBAN_BENEFICIARY_NAME', unitPrice: '20.00' },
  { productCode: 'FREELANCE_CERTIFICATE', unitPrice: '20.00' },
  { productCode: 'PROPERTY_VERIFICATION', unitPrice: '20.00' },
];

/**
 * Opens a default price for each check that has none in force.
 *
 * A price already in force is left alone: somebody may have moved it on purpose, and a
 * seed that runs on every deployment must not quietly put it back.
 */
export async function applyDefaultPriceSeed(
  owner: Queryable,
  prices: readonly DefaultPrice[] = DEFAULT_CHECK_PRICES,
): Promise<void> {
  for (const price of prices) {
    await owner.query(
      `INSERT INTO price_book (tenant_id, product_code, unit_price, tier_min, negative_pct, cache_pct, version)
       SELECT NULL, $1, $2, 0, 0.50, 1.00, 1
       WHERE NOT EXISTS (
         SELECT 1 FROM price_book
         WHERE tenant_id IS NULL AND product_code = $1 AND contract_id IS NULL
           AND tier_min = 0 AND valid_to IS NULL
       )`,
      [price.productCode, price.unitPrice],
    );
  }
}
