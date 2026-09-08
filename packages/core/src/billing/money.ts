/**
 * Money as integer halalas, never as a float.
 *
 * Every price in this platform is Saudi riyals with two decimal places. Doing that
 * arithmetic in binary floating point produces 0.1 + 0.2 = 0.30000000000000004, and in a
 * ledger that has to reconcile against a wallet balance, that difference eventually
 * becomes a support ticket nobody can explain.
 *
 * Prices are stored without VAT and VAT is computed at presentation.
 */

export const HALALAS_PER_RIYAL = 100;

export function riyalsToHalalas(value: number | string): number {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) {
    throw new Error('amount is not a finite number');
  }
  return Math.round(amount * HALALAS_PER_RIYAL);
}

export function halalasToRiyals(halalas: number): number {
  return Math.round(halalas) / HALALAS_PER_RIYAL;
}

/** Formats for storage in a numeric(12,2) column. */
export function halalasToDecimalString(halalas: number): string {
  const rounded = Math.round(halalas);
  const sign = rounded < 0 ? '-' : '';
  const absolute = Math.abs(rounded);
  const whole = Math.floor(absolute / HALALAS_PER_RIYAL);
  const fraction = absolute % HALALAS_PER_RIYAL;
  return `${sign}${whole}.${String(fraction).padStart(2, '0')}`;
}

/** Applies a fraction to an amount, rounding half up to the halala. */
export function applyFraction(halalas: number, fraction: number): number {
  return Math.round(halalas * fraction);
}

export const VAT_RATE = 0.15;

/** VAT is due when the balance is topped up, not when it is consumed. */
export function vatOn(halalas: number): number {
  return Math.round(halalas * VAT_RATE);
}
