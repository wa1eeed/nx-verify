import { applyFraction } from './money.js';
import type { PriceRow } from './price-book.js';
import type { StepOutcome } from '../orchestration/executor.js';

/**
 * Apportioning a product price across its steps.
 *
 * docs/03-products.md section 6 rule 1: the price of a composite product is not the sum
 * of its steps. The product carries one price, and step_weight decides how much of it
 * each step represents. A complete check where four steps of five succeeded is billed by
 * weight, not at the full price and not at a sum of individual step prices that would
 * come out higher than the bundle.
 *
 *   billed = price * (sum of billed weights / sum of all weights)
 *
 * Each step's share is then scaled by what its status earns:
 *
 *   OK          full share
 *   NOT_FOUND   negative_pct of its share. The authority answered.
 *   CACHED      cache_pct of its share, declared per price row, never implied.
 *   ERROR       nothing. We never got an answer.
 *   SKIPPED     nothing. The work never happened.
 */

export interface StepCharge {
  stepKey: string;
  status: string;
  weight: number;
  /** Fraction of this step's share that is charged. */
  rate: number;
  amount: number;
  billable: boolean;
}

export interface BillingBreakdown {
  /** In halalas. */
  total: number;
  steps: StepCharge[];
  totalWeight: number;
  priceId: string;
  unitPrice: number;
}

export function computeBilling(steps: readonly StepOutcome[], price: PriceRow): BillingBreakdown {
  const totalWeight = steps.reduce((sum, step) => sum + step.stepWeight, 0);
  const charges: StepCharge[] = [];
  let total = 0;

  for (const step of steps) {
    const rate = rateFor(step, price);
    const share =
      totalWeight === 0 ? 0 : applyFraction(price.unitPrice, step.stepWeight / totalWeight);
    const amount = rate === 0 ? 0 : applyFraction(share, rate);

    total += amount;
    charges.push({
      stepKey: step.stepKey,
      status: step.status,
      weight: step.stepWeight,
      rate,
      amount,
      billable: amount > 0,
    });
  }

  return { total, steps: charges, totalWeight, priceId: price.id, unitPrice: price.unitPrice };
}

function rateFor(step: StepOutcome, price: PriceRow): number {
  switch (step.status) {
    case 'OK':
      return 1;
    case 'CACHED':
      return price.cachePct;
    case 'NOT_FOUND':
      return price.negativePct;
    case 'ERROR':
    case 'SKIPPED':
      return 0;
    default:
      return 0;
  }
}

/**
 * The worst case for this run, reserved before it starts.
 *
 * Without a reservation a customer holding 40 riyals can start a 58 riyal check and end
 * up with a negative balance, which is a conversation nobody wants to have.
 */
export function maximumCharge(price: PriceRow): number {
  return price.unitPrice;
}
