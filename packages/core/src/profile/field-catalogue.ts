/**
 * What a field is called, and which part of a file it belongs to.
 *
 * One table, in the domain, because the same two answers are needed by the evidence
 * document, by the entity file in the console, and by anything that lists a profile. Two
 * copies of this drift within a month, and the drift shows up as a field labelled one way
 * on screen and another way on the document a customer hands to their auditor.
 *
 * The groups are the tabs of an entity file. They are chosen by what a reader is looking
 * for rather than by which product produced the field: somebody checking a company's
 * banking arrangements wants the account, the holder and the income together, whether
 * they arrived from one product or three.
 */

export type FieldGroup =
  | 'REGISTRY'
  | 'ADDRESS'
  | 'GOVERNANCE'
  | 'OWNERSHIP'
  | 'BANKING'
  | 'INCOME'
  | 'PROPERTY'
  | 'FREELANCE'
  | 'OTHER';

export interface FieldDefinition {
  labelAr: string;
  group: FieldGroup;
  /** Rendered as a figure rather than a value: a number a reader compares. */
  numeric?: boolean;
}

export const FIELD_CATALOGUE: Readonly<Record<string, FieldDefinition>> = {
  'cr.status': { labelAr: 'حالة السجل التجاري', group: 'REGISTRY' },
  'cr.core.name': { labelAr: 'اسم المنشأة', group: 'REGISTRY' },
  'cr.core.capital': { labelAr: 'رأس المال', group: 'REGISTRY', numeric: true },

  'address.national.city': { labelAr: 'المدينة', group: 'ADDRESS' },
  'address.national.district': { labelAr: 'الحي', group: 'ADDRESS' },
  'address.national.building_number': { labelAr: 'رقم المبنى', group: 'ADDRESS' },

  'manager.signing_authority': { labelAr: 'صلاحية التوقيع', group: 'GOVERNANCE' },
  'manager.signing_authority.verified': { labelAr: 'إثبات صلاحية التوقيع', group: 'GOVERNANCE' },

  'owner.percentage': { labelAr: 'نسبة الملكية', group: 'OWNERSHIP', numeric: true },

  'iban.ownership': { labelAr: 'ملكية الآيبان', group: 'BANKING' },
  'iban.bank': { labelAr: 'البنك', group: 'BANKING' },
  'holder.name': { labelAr: 'اسم صاحب الحساب', group: 'BANKING' },
  'account.ownership': { labelAr: 'ملكية الحساب البنكي', group: 'BANKING' },
  'account.status': { labelAr: 'حالة الحساب', group: 'BANKING' },
  'account.match_score': { labelAr: 'درجة مطابقة الاسم', group: 'BANKING', numeric: true },
  'holder.name_match': { labelAr: 'مطابقة اسم صاحب الحساب', group: 'BANKING' },
  'holder.name_confidence': { labelAr: 'ثقة المطابقة', group: 'BANKING', numeric: true },

  'income.monthly_average': { labelAr: 'متوسط الدخل الشهري', group: 'INCOME', numeric: true },
  'income.currency': { labelAr: 'عملة الدخل', group: 'INCOME' },
  'income.payments': { labelAr: 'عدد الدفعات المرصودة', group: 'INCOME', numeric: true },
  'income.last_seen': { labelAr: 'آخر دخل مرصود', group: 'INCOME' },

  'property.deed': { labelAr: 'الصك العقاري', group: 'PROPERTY' },
  'property.type': { labelAr: 'نوع العقار', group: 'PROPERTY' },
  'property.city': { labelAr: 'مدينة العقار', group: 'PROPERTY' },
  'property.district': { labelAr: 'حي العقار', group: 'PROPERTY' },
  'property.area_sqm': { labelAr: 'المساحة بالمتر المربع', group: 'PROPERTY', numeric: true },
  'property.owner': { labelAr: 'مالك العقار', group: 'PROPERTY' },

  'freelance.document': { labelAr: 'وثيقة العمل الحر', group: 'FREELANCE' },
  'freelance.activity': { labelAr: 'نشاط العمل الحر', group: 'FREELANCE' },
  'freelance.expires_on': { labelAr: 'انتهاء وثيقة العمل الحر', group: 'FREELANCE' },
};

export const FIELD_GROUP_LABELS: Readonly<Record<FieldGroup, string>> = {
  REGISTRY: 'السجل التجاري',
  ADDRESS: 'العنوان الوطني',
  GOVERNANCE: 'الإدارة والتوقيع',
  OWNERSHIP: 'الملكية',
  BANKING: 'الحسابات البنكية',
  INCOME: 'الدخل',
  PROPERTY: 'العقارات والصكوك',
  FREELANCE: 'العمل الحر',
  OTHER: 'أخرى',
};

/** The order tabs appear in: identity first, then where, then who, then money. */
export const FIELD_GROUP_ORDER: readonly FieldGroup[] = [
  'REGISTRY',
  'ADDRESS',
  'GOVERNANCE',
  'OWNERSHIP',
  'BANKING',
  'INCOME',
  'PROPERTY',
  'FREELANCE',
  'OTHER',
];

export function fieldLabelAr(fieldPath: string): string {
  return FIELD_CATALOGUE[fieldPath]?.labelAr ?? fieldPath;
}

/**
 * An unknown field lands in "other" rather than being hidden.
 *
 * A product added as rows (rule 8) can produce a field path nobody has labelled yet, and
 * the wrong answer is to drop it: a verified fact that does not appear is worse than one
 * that appears under its raw name.
 */
export function fieldGroup(fieldPath: string): FieldGroup {
  return FIELD_CATALOGUE[fieldPath]?.group ?? 'OTHER';
}

export function isNumericField(fieldPath: string): boolean {
  return FIELD_CATALOGUE[fieldPath]?.numeric ?? false;
}
