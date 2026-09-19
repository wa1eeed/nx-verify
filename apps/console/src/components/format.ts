/**
 * How figures, dates and identifiers read on screen.
 *
 * Money is stored in halalas and shown in riyals with two decimals and grouped thousands,
 * in Latin digits inside a left to right mono span, as the interface rules ask for every
 * figure. One copy of this, so a balance on one screen and the same balance on another
 * cannot be formatted two ways.
 *
 * Time is Riyadh, on every screen, without exception.
 *
 * This file used to hold two clocks. `isoDate` and `dateTime` cut the string out of
 * `toISOString()`, which is UTC, while `dateAr`, `dayMonthAr` and `timeOfDay` asked for
 * Asia/Riyadh. The operator panel drew one, the subscriber settings and the developer screens
 * drew the other, and the same verification run read three hours apart depending on which
 * screen somebody opened. The audit trail was worse: it stacked a UTC date directly above a
 * Riyadh time inside one table cell, so everything recorded between 21:00 and midnight UTC
 * showed yesterday's date over today's time. Two screens had already been hand patched by
 * adding three hours at the call site, which is the shape this fault takes when the clock is
 * not owned in one place.
 *
 * So nothing here produces UTC any more, and no helper that does is exported for a screen to
 * reach for. A date or a time on a console screen comes from this file or it is wrong.
 */

const RIYADH = 'Asia/Riyadh';

const RIYALS = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COUNT = new Intl.NumberFormat('en-US');

/** A figure that is already in riyals. Money is stored in halalas: reach for `riyals`. */
export function riyalsFigure(value: number): string {
  return RIYALS.format(value);
}

/** Money as it is stored, in halalas, written as riyals. */
export function riyals(halalas: number): string {
  return riyalsFigure(halalas / 100);
}

export function count(value: number): string {
  return COUNT.format(value);
}

/**
 * An IBAN in fours.
 *
 * The interface rules require it, and the reason is the task: a Saudi IBAN is twenty four
 * characters, and somebody copying one off a screen into a banking app loses their place in an
 * unbroken run. Any spacing already in the value is dropped first, so grouping the same IBAN
 * twice does not double the gaps.
 */
export function ibanGroups(value: string): string {
  return (value.replace(/\s+/g, '').match(/.{1,4}/g) ?? []).join(' ');
}

const ISO_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: RIYADH,
});

/** «2026-09-18», the Riyadh day. */
export function isoDate(value: Date): string {
  return ISO_DATE.format(value);
}

/** «2026-09», the Riyadh month, as a report names the period it covers. */
export function isoMonth(value: Date): string {
  return isoDate(value).slice(0, 7);
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
    return minutes <= 2
      ? 'منذ دقيقتين'
      : minutes <= 10
        ? `منذ ${minutes} دقائق`
        : `منذ ${minutes} دقيقة`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1
      ? 'منذ ساعة'
      : hours === 2
        ? 'منذ ساعتين'
        : hours <= 10
          ? `منذ ${hours} ساعات`
          : `منذ ${hours} ساعة`;
  }
  const days = Math.floor(hours / 24);
  return `منذ ${daysAr(days)}`;
}

/** «2026-09-18 00:30», the Riyadh day and the Riyadh time on it. */
export function dateTime(value: Date): string {
  return `${isoDate(value)} ${timeOfDay(value)}`;
}

/** The same, to the second, where the second is part of the answer: a call log, a callback. */
export function dateTimeSeconds(value: Date): string {
  return `${isoDate(value)} ${TIME_TO_SECOND.format(value)}`;
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

const DAY_MONTH_AR = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  day: 'numeric',
  month: 'long',
  timeZone: RIYADH,
});

const DATE_AR = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: RIYADH,
});

const TIME_OF_DAY = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: RIYADH,
});

const TIME_TO_SECOND = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: RIYADH,
});

/** «12 سبتمبر», the Gregorian day and month in Arabic, as the handoff writes a recent date. */
export function dayMonthAr(value: Date): string {
  return DAY_MONTH_AR.format(value);
}

/** «14 سبتمبر 2026». */
export function dateAr(value: Date): string {
  return DATE_AR.format(value);
}

/** «09:41», in Riyadh time. */
export function timeOfDay(value: Date): string {
  return TIME_OF_DAY.format(value);
}
