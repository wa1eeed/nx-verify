import type { SubscriberBoardRow, SubscriberStanding } from '@nx-verify/core';
import type { TagTone } from '../ui/tag';
import { count, dateAr, riyals } from '../format';

/**
 * The words of handoff screen 06, worked out apart from the markup: the counts in the forms
 * Arabic gives each number, the month's revenue against the month before, and what each
 * subscriber's row says about its plan, its balance, its term and where it stands.
 */

/** A counted noun in the form Arabic gives that number: one, two, three to ten, and more. */
function counted(
  n: number,
  forms: { one: string; two: string; few: string; many: string; hundreds: string },
): string {
  if (n === 1) {
    return forms.one;
  }
  if (n === 2) {
    return forms.two;
  }
  const tail = n % 100;
  if (tail >= 3 && tail <= 10) {
    return `${count(n)} ${forms.few}`;
  }
  if (tail >= 11) {
    return `${count(n)} ${forms.many}`;
  }
  return `${count(n)} ${forms.hundreds}`;
}

/** «41 مشتركاً نشطاً · 3 اشتراكات تنتهي خلال 14 يوماً». */
export function activeLineAr(active: number, expiring: number, windowDays: number): string {
  const subscribers =
    active === 0
      ? 'لا مشترك نشط'
      : counted(active, {
          one: 'مشترك واحد نشط',
          two: 'مشتركان نشطان',
          few: 'مشتركين نشطين',
          many: 'مشتركاً نشطاً',
          hundreds: 'مشترك نشط',
        });
  const within = `خلال ${windowDays} يوماً`;
  const ending =
    expiring === 0
      ? `لا اشتراك ينتهي ${within}`
      : `${counted(expiring, {
          one: 'اشتراك واحد ينتهي',
          two: 'اشتراكان ينتهيان',
          few: 'اشتراكات تنتهي',
          many: 'اشتراكاً ينتهي',
          hundreds: 'اشتراك ينتهي',
        })} ${within}`;
  return `${subscribers} · ${ending}`;
}

const MONTH_AR = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  month: 'long',
  timeZone: 'UTC',
});

/** «+11% عن أغسطس», and a tone: sage for growth, the accent for a fall. */
export function revenueLineAr(
  changePct: number | null,
  lastMonthStart: Date,
): { textAr: string; tone: 'up' | 'down' | 'none' } {
  const month = MONTH_AR.format(lastMonthStart);
  if (changePct === null) {
    return { textAr: `لا إيراد في ${month} للمقارنة`, tone: 'none' };
  }
  if (changePct >= 0) {
    return { textAr: `+${changePct}% عن ${month}`, tone: 'up' };
  }
  return { textAr: `−${Math.abs(changePct)}% عن ${month}`, tone: 'down' };
}

/** «218,400 ر.س»: the month's revenue in whole riyals, as the figure is drawn. */
export function wholeRiyalsAr(halalas: number): string {
  return `${count(Math.round(halalas / 100))} ر.س`;
}

export const STANDING_TAGS: Readonly<
  Record<SubscriberStanding, { labelAr: string; tone: TagTone }>
> = {
  ACTIVE: { labelAr: 'نشط', tone: 'accent-2' },
  LOW_BALANCE: { labelAr: 'رصيد منخفض', tone: 'accent' },
  EXPIRING: { labelAr: 'ينتهي قريباً', tone: 'accent' },
  SUSPENDED: { labelAr: 'موقوف', tone: 'critical' },
};

type RowFacts = Pick<
  SubscriberBoardRow,
  | 'packageNameAr'
  | 'billingModel'
  | 'largestBundle'
  | 'operationsLeft'
  | 'availableHalalas'
  | 'termEnd'
>;

/** The plan, or «حزمة 10,000» for a subscriber who pays per operation from bundles. */
export function planCellAr(row: RowFacts): string {
  if (row.billingModel === 'PAYG' && row.largestBundle !== null) {
    return `حزمة ${count(row.largestBundle)}`;
  }
  return row.packageNameAr ?? 'بلا باقة';
}

/** Operations left when operations are counted, and riyals when the wallet is the limit. */
export function balanceCellAr(row: RowFacts): string {
  return row.operationsLeft !== null
    ? count(row.operationsLeft)
    : `${riyals(Math.max(0, row.availableHalalas))} ر.س`;
}

/** «12 يناير 2027», or «لا ينتهي» for a plan paid per operation. */
export function endsAr(row: RowFacts): string {
  return row.billingModel === 'PAYG' || row.termEnd === null ? 'لا ينتهي' : dateAr(row.termEnd);
}

/** A cell of the export: quoted when it must be, and never read as a formula. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** The export of screen 06: the table's rows and columns, the plan and the workspace name. */
export function subscribersCsv(rows: readonly SubscriberBoardRow[]): string {
  const lines = [
    [
      'المشترك',
      'مساحة العمل',
      'الباقة',
      'الرصيد المتبقي',
      'ينتهي في',
      'استهلاك 30 يوماً',
      'سعر خاص',
      'الحالة',
    ],
    ...rows.map((row) => [
      row.legalName,
      row.slug,
      planCellAr(row),
      balanceCellAr(row),
      endsAr(row),
      String(row.runs30),
      row.hasSpecialPrice ? 'نعم' : 'لا',
      STANDING_TAGS[row.standing].labelAr,
    ]),
  ];
  // The byte order mark tells a spreadsheet the Arabic is UTF-8.
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
