import type {
  CreditBundle,
  CustomerKind,
  PlanSummary,
  ProfileSection,
  SpecialPrice,
} from '@nx-verify/core';
import { count, dateAr, riyals, timeOfDay } from '../format';

/**
 * The words and figures of handoff screen 05, worked out apart from the markup so each rule
 * is tested once: how a price is read back from a field, how a bundle, a plan and a special
 * price are described, and which sections a kind of file lists.
 */

/** Arabic-Indic and Persian digits, as a keyboard set to Arabic types them. */
function latinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

/**
 * Riyals typed in a field, in halalas. «3.00», «3», «٣٫٥٠» and «1,250» all read; anything
 * else, a third decimal, a sign or a word, is null rather than a guess.
 */
export function parseRiyals(raw: string): number | null {
  const value = latinDigits(raw)
    .replace(/,/g, '')
    .replace(/ر\.س|ريال/g, '')
    .trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) {
    return null;
  }
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** The first whole number in a field: «90 يوماً» is 90, «85%» is 85. Null when there is none. */
export function parseWholeNumber(raw: string): number | null {
  const match = latinDigits(raw).match(/\d{1,6}/);
  return match === null ? null : Number(match[0]);
}

/** A share typed in a field: «18», «18%», «١٨٫٥». Null for anything that is not one. */
export function parsePercent(raw: string): number | null {
  const value = latinDigits(raw).replace('%', '').trim();
  return /^\d{1,2}(\.\d{1,2})?$/.test(value) ? Number(value) : null;
}

/** A price as the field shows it: «3.00», without grouping, so it reads back as typed. */
export function priceField(halalas: number | null): string {
  return halalas === null ? '' : (halalas / 100).toFixed(2);
}

/** «90 يوماً», with the digits kept, so the field reads back to the number it shows. */
export function daysField(days: number): string {
  if (days >= 11) {
    return `${days} يوماً`;
  }
  return days >= 3 ? `${days} أيام` : `${days} يوم`;
}

/** «500 عملية»: a count of operations. */
export function operationsAr(n: number): string {
  return `${count(n)} عملية`;
}

/** «12 شهراً», «3 أشهر». */
export function monthsAr(n: number): string {
  if (n === 1) {
    return 'شهر واحد';
  }
  if (n === 2) {
    return 'شهرين';
  }
  return n <= 10 ? `${n} أشهر` : `${n} شهراً`;
}

/** «1,250 ر.س», a whole amount without its halalas, as the screen writes a price list. */
export function sar(halalas: number): string {
  return halalas % 100 === 0 ? `${count(halalas / 100)} ر.س` : `${riyals(halalas)} ر.س`;
}

/** The line under the bundles' title: how long the shortest bundle lasts. */
export function bundlesLineAr(bundles: readonly CreditBundle[]): string {
  const months = bundles.length === 0 ? 12 : Math.min(...bundles.map((b) => b.validityMonths));
  return `تُشترى مرة واحدة ولا تنتهي قبل ${monthsAr(months)}`;
}

/** «−8%»: how much cheaper an operation is than in the smallest bundle. */
export function discountAr(pct: number | null): string | null {
  return pct === null ? null : `−${pct}%`;
}

/** A plan's price and its terms, as the subscriptions card lists them. */
export function planLinesAr(plan: PlanSummary): { price: string; terms: string } {
  if (plan.billingModel === 'PAYG') {
    return { price: 'بلا رسم شهري', terms: 'كل عملية بسعر منتجها' };
  }
  if (plan.negotiated) {
    return { price: 'سعر تفاوضي', terms: 'حد مخصص · تجاوز مخصص' };
  }
  const included =
    plan.includedTransactions === null ? 'حد مخصص' : operationsAr(plan.includedTransactions);
  const overage =
    plan.overageUnitHalalas === null ? 'بلا تجاوز' : `تجاوز ${riyals(plan.overageUnitHalalas)} ر.س`;
  return {
    price: plan.monthlyFeeHalalas === 0 ? 'بلا رسم شهري' : `${sar(plan.monthlyFeeHalalas)} / شهر`,
    terms: `${included} · ${overage}`,
  };
}

/** «السجل التجاري 2.40 · الآيبان 1.10», or «خصم 18% على كل المنتجات». */
export function specialLineAr(special: SpecialPrice): string {
  const parts = special.products.map(
    (product) => `${product.nameAr} ${riyals(product.priceHalalas)}`,
  );
  if (special.discountPct !== null) {
    parts.push(`خصم ${formatPct(special.discountPct)}% على كل المنتجات`);
  }
  return parts.join(' · ');
}

function formatPct(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '');
}

/** «آخر تعديل بواسطة وليد الغامدي · 12 سبتمبر 2026، 16:31». */
export function lastChangeAr(
  change: { byName: string; at: Date } | null,
  none = 'لم يُعدَّل أي سعر أو إعداد بعد',
): string {
  return change === null
    ? none
    : `آخر تعديل بواسطة ${change.byName} · ${dateAr(change.at)}، ${timeOfDay(change.at)}`;
}

/** The kinds of file, in the order and with the names screen 05 gives them. */
export const KIND_HEADINGS: readonly (readonly [CustomerKind, string])[] = [
  ['COMPANY', 'الأقسام المطلوبة · شركة'],
  ['ESTABLISHMENT', 'الأقسام المطلوبة · مؤسسة'],
  ['FREELANCER', 'الأقسام المطلوبة · عامل حر'],
];

/** The section tags of screen 05: each named by the check that fills it. */
export const SECTION_TAGS: Readonly<Record<ProfileSection, { name: string; short: string }>> = {
  REGISTRY: { name: 'السجل التجاري', short: 'السجل التجاري' },
  CONTRACT: { name: 'عقد التأسيس', short: 'عقد التأسيس' },
  MANAGERS: { name: 'المدراء المفوضون', short: 'المدراء' },
  ADDRESS: { name: 'العنوان الوطني', short: 'العنوان الوطني' },
  BANKING: { name: 'الآيبان', short: 'الآيبان' },
  FREELANCE: { name: 'شهادة الفريلانسر', short: 'شهادة الفريلانسر' },
  PROPERTY: { name: 'العقارات', short: 'العقارات' },
  INCOME: { name: 'الدخل الشهري', short: 'الدخل' },
};

/** «المدراء · اختياري». */
export function optionalTagAr(section: ProfileSection): string {
  return `${SECTION_TAGS[section].short} · اختياري`;
}

/** Why a save was refused, or what it did, from the address the action sent the screen to. */
export function noticeAr(
  params: Readonly<Record<string, string | undefined>>,
  nameOf: (code: string) => string,
): { tone: 'done' | 'refused'; text: string } | null {
  const product = params['product'] === undefined ? '' : nameOf(params['product']);
  switch (params['refused']) {
    case undefined:
      break;
    case 'role':
      return { tone: 'refused', text: 'دورك في اللوحة لا يسمح بهذا التعديل.' };
    case 'price':
      return { tone: 'refused', text: `لم تُحفظ التغييرات: سعر ${product} غير صالح.` };
    case 'under-cost':
      return {
        tone: 'refused',
        text: `لم تُحفظ التغييرات: سعر ${product} أقل من تكلفته، والسعر لا ينزل عن التكلفة.`,
      };
    case 'settings':
      return {
        tone: 'refused',
        text: 'لم تُحفظ التغييرات: المحاولات من 1 إلى 5، والصلاحية من يوم إلى 3650 يوماً، وحد التطابق من 50% إلى 100%، والتنبيه من يوم إلى 365 يوماً.',
      };
    case 'bundle-cost':
      return {
        tone: 'refused',
        text: 'لم تُضف الحزمة: سعر العملية فيها أقل من تكلفة أغلى تحقق.',
      };
    case 'plan-cost':
      return { tone: 'refused', text: 'لم تُضف الباقة: سعر التجاوز أقل من تكلفة أغلى تحقق.' };
    case 'plan-exists':
      return { tone: 'refused', text: 'لم تُضف الباقة: يوجد باقة بالرمز نفسه.' };
    case 'special-cost':
      return {
        tone: 'refused',
        text: 'لم يُحفظ السعر الخاص: ينزل بسعر منتج عن تكلفته.',
      };
    default:
      return { tone: 'refused', text: 'لم تُحفظ التغييرات: تحقق من القيم المدخلة.' };
  }
  switch (params['saved']) {
    case undefined:
      return null;
    case 'bundle':
      return { tone: 'done', text: 'حُفظت الحزمة.' };
    case 'bundle-retired':
      return {
        tone: 'done',
        text: 'أُوقف بيع الحزمة. ما اشتراه المشتركون منها يبقى لهم حتى ينتهي.',
      };
    case 'plan':
      return { tone: 'done', text: 'أُضيفت الباقة.' };
    case 'special':
      return { tone: 'done', text: 'حُفظ السعر الخاص.' };
    default: {
      const thin = (params['thin'] ?? '').split(',').filter((code) => code !== '');
      return {
        tone: 'done',
        text:
          thin.length === 0
            ? 'حُفظت التغييرات.'
            : `حُفظت التغييرات. الهامش أقل من 30% في: ${thin.map(nameOf).join('، ')}.`,
      };
    }
  }
}
