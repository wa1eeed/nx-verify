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

/** How long ago, in the words a person uses: minutes, hours, days. */
export function sinceAr(date: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) {
    return 'الآن';
  }
  if (minutes < 60) {
    return minutes <= 2 ? 'منذ دقيقتين' : minutes <= 10 ? `منذ ${minutes} دقائق` : `منذ ${minutes} دقيقة`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? 'منذ ساعة' : hours === 2 ? 'منذ ساعتين' : hours <= 10 ? `منذ ${hours} ساعات` : `منذ ${hours} ساعة`;
  }
  const days = Math.floor(hours / 24);
  return `منذ ${daysAr(days)}`;
}

export function dateTime(value: Date): string {
  return value.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * A masked identifier, shortened for reading.
 *
 * The domain masks every character but the last four, which keeps an IBAN twenty bullets
 * long. Four are enough to say "hidden", and the last four are what a person compares.
 */
export function shortMask(masked: string | null): string | null {
  return masked === null ? null : masked.replace(/•{4,}/g, '••••');
}
