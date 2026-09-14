import type { HomeOverview, HomeRun } from '@nx-verify/core';
import type { TagTone } from '../ui/tag';
import { count, dateAr, dayMonthAr, daysAr, riyals, timeOfDay } from '../format';

/**
 * The words and figures of the home screen, worked out without React (handoff screen 01).
 *
 * The greeting follows the hour in Riyadh, the update line says «اليوم» for today, a package
 * says when it ends and how many days are left, and each operation's status reads in the
 * handoff's words: «مُتحقق» sage, «قيد المعالجة» neutral, and a fact that does not hold in the
 * accent with the words its file uses.
 */

const HOUR_MS = 3_600_000;

function riyadhDay(value: Date): string {
  return new Date(value.getTime() + 3 * HOUR_MS).toISOString().slice(0, 10);
}

export function greetingAr(name: string | null, now: Date): string {
  const hour = new Date(now.getTime() + 3 * HOUR_MS).getUTCHours();
  const greeting = hour < 12 ? 'صباح الخير' : 'مساء الخير';
  return name === null ? greeting : `${greeting}، ${name}`;
}

/** «آخر تحديث للبيانات اليوم 14 سبتمبر 2026، 09:42». */
export function updatedAr(at: Date | null, now: Date): string {
  if (at === null) {
    return 'لم يُتحقق من أي عميل بعد';
  }
  const today = riyadhDay(at) === riyadhDay(now) ? 'اليوم ' : '';
  return `آخر تحديث للبيانات ${today}${dateAr(at)}، ${timeOfDay(at)}`;
}

export interface PackageLine {
  nameAr: string;
  endsAr: string;
  leftAr: string;
}

export function packageLine(commitment: HomeOverview['commitment'], now: Date): PackageLine | null {
  if (commitment === null) {
    return null;
  }
  const days = Math.ceil((commitment.termEnd.getTime() - now.getTime()) / (24 * HOUR_MS));
  return {
    nameAr: commitment.packageNameAr,
    endsAr:
      days < 0 ? `انتهت ${dateAr(commitment.termEnd)}` : `تنتهي ${dateAr(commitment.termEnd)}`,
    leftAr:
      days < 0
        ? 'جدّد الباقة لتستمر عمليات التحقق'
        : days === 0
          ? 'آخر يوم'
          : `${daysAr(days)} متبقية`,
  };
}

export interface RunStatus {
  tone: TagTone;
  text: string;
}

export function runStatus(run: HomeRun): RunStatus {
  if (run.conflictAr !== null) {
    // Screen 02 and the home table word a bank name conflict the way a row has room for.
    return {
      tone: 'accent',
      text: run.conflictAr === 'تعارض في الاسم' ? 'اسم غير مطابق' : run.conflictAr,
    };
  }
  switch (run.status) {
    case 'OK':
      return { tone: 'accent-2', text: 'مُتحقق' };
    case 'PARTIAL':
      return { tone: 'accent-2', text: 'مُتحقق جزئياً' };
    case 'NOT_FOUND':
      return { tone: 'neutral', text: 'غير موجود' };
    case 'ERROR':
      return { tone: 'neutral', text: 'فشل' };
    default:
      return { tone: 'neutral', text: 'قيد المعالجة' };
  }
}

/** Who a row is about: «عبدالله الشمري · عامل حر» for a freelancer. */
export function customerAr(run: HomeRun): string {
  const name = run.entityName ?? 'عميل بلا اسم بعد';
  return run.entityType === 'FREELANCER' ? `${name} · عامل حر` : name;
}

/** What an operation cost: riyals before VAT, the package, or nothing for a call that failed. */
export function costAr(run: HomeRun): { riyals: string | null; wordsAr: string | null } {
  if (run.status === 'ERROR' || run.status === 'PENDING' || run.status === 'AWAITING') {
    return { riyals: null, wordsAr: '·' };
  }
  if (run.chargeSource === 'PACKAGE') {
    return { riyals: null, wordsAr: 'من الباقة' };
  }
  if (run.chargeSource === 'FREE') {
    return { riyals: null, wordsAr: 'دون رسوم' };
  }
  return run.billedHalalas === null
    ? { riyals: null, wordsAr: '·' }
    : { riyals: riyals(run.billedHalalas), wordsAr: null };
}

export function runDayAr(run: HomeRun): string {
  return dayMonthAr(run.createdAt);
}

/** «متوسط زمن الاستجابة 6.4 ثانية · 99.1% من العمليات اكتملت من المحاولة الأولى.» */
export function performanceAr(performance: HomeOverview['performance']): string | null {
  if (
    performance.runs === 0 ||
    performance.averageMs === null ||
    performance.completedShare === null
  ) {
    return null;
  }
  const seconds =
    performance.averageMs < 100
      ? 'أقل من 0.1 ثانية'
      : `${(performance.averageMs / 1000).toFixed(1)} ثانية`;
  const share = (performance.completedShare * 100).toFixed(1).replace(/\.0$/, '');
  return `متوسط زمن الاستجابة ${seconds} · ${share}% من العمليات اكتملت من المحاولة الأولى.`;
}

/** The consumption bars: the busier half in the accent, the rest in sage. */
export function consumptionBars(consumption: HomeOverview['consumption']): {
  productCode: string;
  nameAr: string;
  countAr: string;
  share: number;
  tone: 'accent' | 'accent-2';
}[] {
  const max = Math.max(0, ...consumption.map((entry) => entry.count));
  const accent = Math.ceil(consumption.length / 2);
  return consumption.map((entry, index) => ({
    productCode: entry.productCode,
    nameAr: entry.nameAr,
    countAr: count(entry.count),
    share: max === 0 ? 0 : entry.count / max,
    tone: index < accent ? 'accent' : 'accent-2',
  }));
}
