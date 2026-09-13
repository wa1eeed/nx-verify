/**
 * How figures and dates read on screen.
 *
 * Money is stored in halalas and shown in riyals with two decimals and grouped thousands,
 * in Latin digits inside a left to right mono span, as the interface rules ask for every
 * figure. One copy of this, so a balance on one screen and the same balance on another
 * cannot be formatted two ways.
 */

const RIYALS = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COUNT = new Intl.NumberFormat('en-US');

export function riyals(halalas: number): string {
  return RIYALS.format(halalas / 100);
}

export function count(value: number): string {
  return COUNT.format(value);
}

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** A number of days, in the form Arabic uses for that number. */
export function daysAr(days: number): string {
  const n = Math.abs(days);
  if (n === 0) {
    return 'اليوم';
  }
  if (n === 1) {
    return 'يوم واحد';
  }
  if (n === 2) {
    return 'يومان';
  }
  if (n <= 10) {
    return `${n} أيام`;
  }
  return `${n} يوماً`;
}

/** "ends in ..." or "ended ... ago", for a term. */
export function termPhrase(daysLeft: number): string {
  if (daysLeft === 0) {
    return 'تنتهي اليوم';
  }
  return daysLeft > 0 ? `تنتهي بعد ${daysAr(daysLeft)}` : `انتهت منذ ${daysAr(daysLeft)}`;
}
