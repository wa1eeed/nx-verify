import type { Queryable } from '../client.js';

/**
 * What each provider call costs us.
 *
 * These are negotiated commercial terms, not estimates. They are seeded because the
 * margin check, the operator margin screen and the guard that refuses a price below cost
 * all read the same table, and a cost that lives in a spreadsheet is a cost none of them
 * can see.
 *
 * Keyed on the call and not on the product. A product that makes five calls costs five
 * calls, and the only way a price can be checked against that is for each call to carry
 * its own figure. This is why the national address is its own endpoint: it is a different
 * call at a different price, and an endpoint standing for both could be priced as neither.
 */

export interface SeedCost {
  provider: string;
  endpoint: string;
  /** In riyals, excluding VAT, as the column stores it. */
  unitCost: string;
  note: string;
}

/**
 * Lean Technologies, agreed 2026-09-13: ten riyals a verification across the catalogue,
 * two riyals for the national address. Resale inside NX is permitted under that
 * agreement, which is what makes the managed model below possible at all.
 */
export const LEAN_COSTS: readonly SeedCost[] = [
  { provider: 'lean', endpoint: 'national_address', unitCost: '2.00', note: 'national address' },
  { provider: 'lean', endpoint: 'business_verification', unitCost: '10.00', note: 'registry' },
  { provider: 'lean', endpoint: 'articles_of_association', unitCost: '10.00', note: 'articles' },
  { provider: 'lean', endpoint: 'manager_permissions', unitCost: '10.00', note: 'managers' },
  {
    provider: 'lean',
    endpoint: 'ultimate_beneficial_owner',
    unitCost: '10.00',
    note: 'ownership',
  },
  { provider: 'lean', endpoint: 'iban_ownership', unitCost: '10.00', note: 'iban ownership' },
  {
    provider: 'lean',
    endpoint: 'bank_account_ownership',
    unitCost: '10.00',
    note: 'account ownership',
  },
  { provider: 'lean', endpoint: 'name_match', unitCost: '10.00', note: 'name match' },
  { provider: 'lean', endpoint: 'income_verification', unitCost: '10.00', note: 'income' },
  {
    provider: 'lean',
    endpoint: 'freelancer_certificate',
    unitCost: '10.00',
    note: 'freelance certificate',
  },
  { provider: 'lean', endpoint: 'property_deed', unitCost: '10.00', note: 'property deed' },
];

/**
 * The simulation provider costs nothing, and saying so is not a formality.
 *
 * Without a row the margin check finds no cost for the step and reports a margin of one,
 * which would make a sandbox deployment look more profitable than any real one.
 */
export const STUB_COSTS: readonly SeedCost[] = LEAN_COSTS.map((cost) => ({
  ...cost,
  provider: 'stub',
  unitCost: '0.00',
  note: 'simulation, costs nothing',
}));

export async function applyCostSeed(
  db: Queryable,
  costs: readonly SeedCost[] = [...LEAN_COSTS, ...STUB_COSTS],
): Promise<void> {
  for (const cost of costs) {
    // A cost is a dated row rather than a value that is edited: a price agreed today must
    // not silently rewrite what a run three months ago was charged against.
    await db.query(
      `INSERT INTO cost_book (provider, endpoint, unit_cost)
       SELECT $1, $2, $3::numeric
       WHERE NOT EXISTS (
         SELECT 1 FROM cost_book
         WHERE provider = $1 AND endpoint = $2 AND valid_to IS NULL
           AND unit_cost = $3::numeric
       )`,
      [cost.provider, cost.endpoint, cost.unitCost],
    );
  }
}
