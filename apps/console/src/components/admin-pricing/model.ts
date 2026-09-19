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

/**
 * What a NOT_FOUND or a CACHED answer earns, typed as a whole percentage, as the fraction the
 * price row holds: «50» is 0.5 and «100» is 1.
 *
 * A hundred is a real answer here, unlike a discount, and a fraction of a percent is not: the
 * column keeps two decimals of a fraction, so «12.5%» would be stored as something nobody
 * typed. It is refused rather than rounded.
 */
export function parseRateFraction(raw: string): number | null {
  const value = latinDigits(raw).replace('%', '').trim();
  if (!/^\d{1,3}$/.test(value)) {
    return null;
  }
  const percent = Number(value);
  return percent > 100 ? null : percent / 100;
}

/** «50» for a half: the rate fields show whole percents. */
export function ratePctField(fraction: number | null | undefined): string {
  return fraction === null || fraction === undefined ? '' : String(Math.round(fraction * 100));
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

/**
 * What one operation of a bundle costs, how long it lasts, and against what its discount is
 * measured.
 *
 * The card used to show the whole price and a «−8%» with no base named, and one line at the
 * top claiming a validity that was the shortest bundle's rather than this one's. The price of
 * an operation is the figure two bundles are compared by and the one the cost floor is
 * measured against, and it was computed and never shown.
 */
export function bundleTermsAr(bundle: CreditBundle): string {
  const parts = [
    `سعر العملية ${riyals(bundle.perOperationHalalas)} ر.س`,
    `صالحة ${monthsAr(bundle.validityMonths)}`,
  ];
  if (bundle.discountPct !== null) {
    parts.push(`أقل ${bundle.discountPct}% من سعر العملية في أصغر حزمة`);
  }
  return parts.join(' · ');
}

/** «−8%»: how much cheaper an operation is than in the smallest bundle. */
export function discountAr(pct: number | null): string | null {
  return pct === null ? null : `−${pct}%`;
}

/**
 * A plan's price, what it includes, and the terms that decide money nobody could see.
 *
 * The third line is the point: the free re-verification window prices a repeat check at zero
 * (verify.ts), and it was a literal in the code that no screen printed. Beside it the term, the
 * setup fee, the credit the term grants, and whether work continues at all past the included
 * operations.
 */
export function planLinesAr(plan: PlanSummary): {
  price: string;
  terms: string;
  commitment: string;
} {
  const commitment = [
    `التزام ${monthsAr(plan.termMonths)}`,
    plan.freeReverifyDays === 0
      ? 'كل إعادة تحقق تُحسب'
      : `إعادة التحقق خلال ${daysField(plan.freeReverifyDays)} بلا رسم`,
    plan.setupFeeHalalas === 0 ? 'بلا رسم تأسيس' : `رسم تأسيس ${sar(plan.setupFeeHalalas)}`,
    ...(plan.commitmentCreditsHalalas === 0
      ? []
      : [`رصيد عند التوقيع ${sar(plan.commitmentCreditsHalalas)}`]),
  ].join(' · ');

  if (plan.billingModel === 'PAYG') {
    return { price: 'بلا رسم شهري', terms: 'كل عملية بسعر منتجها', commitment };
  }
  if (plan.negotiated) {
    return { price: 'سعر تفاوضي', terms: 'حد مخصص · تجاوز مخصص', commitment };
  }
  const included =
    plan.includedTransactions === null ? 'حد مخصص' : operationsAr(plan.includedTransactions);
  const overage = !plan.overageAllowed
    ? 'يتوقف العمل عند الحد'
    : plan.overageUnitHalalas === null
      ? 'بلا تجاوز'
      : `تجاوز ${riyals(plan.overageUnitHalalas)} ر.س`;
  return {
    price: plan.monthlyFeeHalalas === 0 ? 'بلا رسم شهري' : `${sar(plan.monthlyFeeHalalas)} / شهر`,
    terms: `${included} · ${overage}`,
    commitment,
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
  FREELANCE: { name: 'وثيقة العمل الحر', short: 'وثيقة العمل الحر' },
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
    case 'rate':
      return {
        tone: 'refused',
        text: `لم تُحفظ التغييرات: نسبة حالة في ${product} خارج المدى. النسبة رقم صحيح من 0 إلى 100.`,
      };
    case 'clear-on-sale':
      return {
        tone: 'refused',
        text: `لم تُحفظ التغييرات: ${product} معروض للبيع، وبلا سعر يفشل كل تشغيل له. أوقف بيعه ثم امسح السعر.`,
      };
    case 'no-price':
      return {
        tone: 'refused',
        text: `لم تُحفظ التغييرات: لا سعر لـ${product}، ولا يُعرض للبيع منتج بلا سعر.`,
      };
    case 'bundle-exists':
      return {
        tone: 'refused',
        text: 'لم تُضف الحزمة: توجد حزمة بعدد العمليات نفسه. اختر عدداً آخر، أو استبدلها من زر التعديل بجانبها.',
      };
    case 'bundle-missing':
      return {
        tone: 'refused',
        text: 'لم تُحفظ الحزمة: الحزمة المراد استبدالها لم تعد موجودة.',
      };
    case 'plan-missing':
      return { tone: 'refused', text: 'لم تُحفظ الشروط: لا باقة مفعّلة بهذا الرمز.' };
    case 'plan-terms':
      return {
        tone: 'refused',
        text: 'لم تُحفظ الشروط: الالتزام 3 أو 12 أو 24 شهراً، ونافذة إعادة التحقق المجانية من 0 إلى 365 يوماً.',
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
    case 'vat-rate':
      return { tone: 'refused', text: 'لم تُعلَن القاعدة: النسبة من 0 إلى 100.' };
    case 'vat-number':
      return {
        tone: 'refused',
        text: 'لم تُعلَن القاعدة: الفترة المسجّلة تحتاج الرقم الضريبي (15 رقماً).',
      };
    case 'vat-order':
      return {
        tone: 'refused',
        text: 'لم تُعلَن القاعدة: لا تبدأ فترة قبل فترة مسجّلة، لأن ذلك يغيّر فواتير صدرت.',
      };
    default:
      return { tone: 'refused', text: 'لم تُحفظ التغييرات: تحقق من القيم المدخلة.' };
  }
  switch (params['saved']) {
    case undefined:
      return null;
    case 'bundle':
      return { tone: 'done', text: 'أُضيفت الحزمة.' };
    case 'bundle-replaced':
      return {
        tone: 'done',
        text: 'اُستبدلت الحزمة. ما اشتراه المشتركون بسعرها السابق يبقى كما اشتروه.',
      };
    case 'bundle-retired':
      return {
        tone: 'done',
        text: 'أُوقف بيع الحزمة. ما اشتراه المشتركون منها يبقى لهم حتى ينتهي.',
      };
    case 'plan':
      return { tone: 'done', text: 'أُضيفت الباقة.' };
    case 'plan-terms':
      return {
        tone: 'done',
        text: 'حُفظت شروط الباقة. نافذة إعادة التحقق المجانية وإيقاف العمل عند الحد يسريان على المشتركين الحاليين، وسعر التجاوز على من يوقّع بعد الآن.',
      };
    case 'special':
      return { tone: 'done', text: 'حُفظ السعر الخاص.' };
    case 'vat':
      return {
        tone: 'done',
        text: 'أُعلنت قاعدة الضريبة. ما صدر من فواتير يبقى محسوباً بقاعدة تاريخه.',
      };
    default: {
      const codes = (key: string): string[] =>
        (params[key] ?? '').split(',').filter((code) => code !== '');
      const thin = codes('thin');
      const cleared = codes('cleared');
      const sentences = ['حُفظت التغييرات.'];
      if (cleared.length > 0) {
        sentences.push(`أُلغي سعر: ${cleared.map(nameOf).join('، ')}.`);
      }
      if (thin.length > 0) {
        sentences.push(`الهامش أقل من 30% في: ${thin.map(nameOf).join('، ')}.`);
      }
      return { tone: 'done', text: sentences.join(' ') };
    }
  }
}
