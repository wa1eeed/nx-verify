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
  | 'CONTRACT'
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
  /**
   * Recorded and used, never listed as a line of its own: a status code the status text
   * already says, the kind that is shown as the file's classification, a key that exists
   * only so two addresses can be compared.
   */
  hidden?: boolean;
  /** Words for the values an authority answers with in its own vocabulary. */
  values?: Readonly<Record<string, string>>;
}

const YES_NO = { true: 'نعم', false: 'لا' } as const;

export const FIELD_CATALOGUE: Readonly<Record<string, FieldDefinition>> = {
  'cr.status': { labelAr: 'حالة السجل التجاري', group: 'REGISTRY' },
  'cr.core.name': { labelAr: 'اسم المنشأة', group: 'REGISTRY' },
  'cr.core.capital': { labelAr: 'رأس المال', group: 'REGISTRY', numeric: true },
  'cr.status_code': { labelAr: 'رمز حالة السجل', group: 'REGISTRY', hidden: true },
  'cr.kind': {
    labelAr: 'التصنيف',
    group: 'REGISTRY',
    hidden: true,
    values: { COMPANY: 'شركة', ESTABLISHMENT: 'مؤسسة' },
  },
  'cr.entity_type': { labelAr: 'نوع الكيان', group: 'REGISTRY' },
  'cr.legal_form': { labelAr: 'الشكل القانوني', group: 'REGISTRY' },
  'cr.issue_date': { labelAr: 'تاريخ إصدار السجل', group: 'REGISTRY' },
  'cr.confirmation_date': { labelAr: 'تاريخ تأكيد السجل', group: 'REGISTRY' },
  'cr.suspension_date': { labelAr: 'تاريخ الإيقاف', group: 'REGISTRY' },
  'cr.deletion_date': { labelAr: 'تاريخ الشطب', group: 'REGISTRY' },
  'cr.headquarters_city': { labelAr: 'المدينة الرئيسية', group: 'REGISTRY' },
  'cr.activities': { labelAr: 'الأنشطة', group: 'REGISTRY' },
  'cr.in_liquidation': { labelAr: 'تحت التصفية', group: 'REGISTRY', values: YES_NO },
  'cr.has_ecommerce': { labelAr: 'متجر إلكتروني مسجّل', group: 'REGISTRY', values: YES_NO },
  'cr.is_main': { labelAr: 'سجل رئيسي', group: 'REGISTRY', values: YES_NO },
  'cr.license_issuer': { labelAr: 'جهة الترخيص', group: 'REGISTRY' },
  'cr.website': { labelAr: 'الموقع الإلكتروني', group: 'REGISTRY' },
  'cr.fiscal_year_end': { labelAr: 'نهاية السنة المالية', group: 'REGISTRY' },
  'cr.partners_nationality': { labelAr: 'جنسية الشركاء', group: 'REGISTRY' },

  'contract.date': { labelAr: 'تاريخ عقد التأسيس', group: 'CONTRACT' },
  'contract.copy_number': { labelAr: 'رقم نسخة العقد', group: 'CONTRACT' },
  'contract.capital': { labelAr: 'رأس المال في العقد', group: 'CONTRACT', numeric: true },
  'contract.capital_type': { labelAr: 'نوع رأس المال', group: 'CONTRACT' },
  'contract.cash_capital': { labelAr: 'رأس المال النقدي', group: 'CONTRACT', numeric: true },
  'contract.in_kind_capital': { labelAr: 'رأس المال العيني', group: 'CONTRACT', numeric: true },
  'contract.profit_set_aside_pct': {
    labelAr: 'نسبة الاحتياطي من الأرباح',
    group: 'CONTRACT',
    numeric: true,
  },
  'contract.partner_decisions': { labelAr: 'قرارات الشركاء ونسب إقرارها', group: 'CONTRACT' },
  'contract.articles_count': { labelAr: 'عدد مواد العقد', group: 'CONTRACT', numeric: true },
  'ownership.partners_total': { labelAr: 'عدد الشركاء', group: 'CONTRACT', numeric: true },
  'contract.management_structure': { labelAr: 'هيكل الإدارة في العقد', group: 'CONTRACT' },
  'contract.dismissal_method': { labelAr: 'طريقة عزل المدير', group: 'CONTRACT' },
  'contract.board_members': { labelAr: 'أعضاء مجلس المديرين', group: 'CONTRACT', numeric: true },
  'contract.managers_total': { labelAr: 'عدد المدراء في العقد', group: 'CONTRACT', numeric: true },
  'contract.partners_total': { labelAr: 'عدد الشركاء في العقد', group: 'CONTRACT', numeric: true },

  'governance.structure': { labelAr: 'هيكل الإدارة', group: 'GOVERNANCE' },
  'governance.managers_total': { labelAr: 'عدد المدراء', group: 'GOVERNANCE', numeric: true },
  'governance.dismissal_method': { labelAr: 'طريقة عزل المدير', group: 'GOVERNANCE' },
  'governance.board_members': {
    labelAr: 'أعضاء مجلس المديرين',
    group: 'GOVERNANCE',
    numeric: true,
  },

  'address.national.city': { labelAr: 'المدينة', group: 'ADDRESS' },
  'address.national.district': { labelAr: 'الحي', group: 'ADDRESS' },
  'address.national.building_number': { labelAr: 'رقم المبنى', group: 'ADDRESS' },
  'address.national.street': { labelAr: 'الشارع', group: 'ADDRESS' },
  'address.national.postal_code': { labelAr: 'الرمز البريدي', group: 'ADDRESS' },
  'address.national.additional_number': { labelAr: 'الرقم الإضافي', group: 'ADDRESS' },
  'address.national.region': { labelAr: 'المنطقة', group: 'ADDRESS' },
  'address.national.unit_number': { labelAr: 'رقم الوحدة', group: 'ADDRESS' },
  'address.national.status': { labelAr: 'حالة العنوان', group: 'ADDRESS' },
  'address.national.count': { labelAr: 'عدد العناوين المسجلة', group: 'ADDRESS', numeric: true },
  'address.national.key': { labelAr: 'مفتاح المقارنة', group: 'ADDRESS', hidden: true },
  'address.national.latitude': { labelAr: 'خط العرض', group: 'ADDRESS', hidden: true },
  'address.national.longitude': { labelAr: 'خط الطول', group: 'ADDRESS', hidden: true },

  'manager.signing_authority': { labelAr: 'صلاحية التوقيع', group: 'GOVERNANCE' },
  'manager.signing_authority.verified': { labelAr: 'إثبات صلاحية التوقيع', group: 'GOVERNANCE' },

  'owner.percentage': { labelAr: 'نسبة الملكية', group: 'OWNERSHIP', numeric: true },

  'iban.ownership': { labelAr: 'ملكية الآيبان', group: 'BANKING' },
  'bank.iban_ownership': {
    labelAr: 'مطابقة ملكية الآيبان',
    group: 'BANKING',
    values: { MATCH: 'مطابق', PARTIAL: 'تطابق جزئي في الاسم', NO_MATCH: 'غير مطابق' },
  },
  'bank.match_score': { labelAr: 'درجة تطابق الاسم', group: 'BANKING', numeric: true },
  'bank.name': { labelAr: 'البنك', group: 'BANKING' },
  'bank.swift_code': { labelAr: 'رمز السويفت', group: 'BANKING' },
  'bank.account_status': {
    labelAr: 'حالة الحساب',
    group: 'BANKING',
    values: {
      ACTIVE: 'نشط',
      BLOCKED: 'محظور',
      INACTIVE: 'غير نشط',
      CLOSED: 'مغلق',
      DORMANT: 'راكد',
    },
  },
  'bank.holder_name': { labelAr: 'اسم صاحب الحساب كما يظهر لدى البنك', group: 'BANKING' },
  'bank.beneficiary_name': { labelAr: 'اسم المستفيد', group: 'BANKING' },
  'bank.verification_method': {
    labelAr: 'طريقة التأكيد',
    group: 'BANKING',
    values: {
      SARIE: 'نظام سريع',
      CONFIRMATION_OF_PAYEE_SERVICE: 'خدمة التحقق من المستفيد',
      OPEN_BANKING: 'المصرفية المفتوحة',
      SARIE_AND_CONFIRMATION_OF_PAYEE_SERVICE: 'سريع وخدمة التحقق من المستفيد',
    },
  },
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
  'freelance.ownership': {
    labelAr: 'ملكية الوثيقة',
    group: 'FREELANCE',
    values: {
      VERIFIED: 'تعود لصاحب الهوية',
      NOT_VERIFIED: 'لا تعود لصاحب الهوية',
      NOT_CHECKED: 'لم تُفحص',
    },
  },
  'freelance.certificate_status': {
    labelAr: 'حالة الوثيقة',
    group: 'FREELANCE',
    values: {
      ACTIVE: 'سارية',
      EXPIRED: 'منتهية',
      CANCELED: 'ملغاة',
      REVOKED: 'مسحوبة',
      REJECTED: 'مرفوضة',
      PENDING: 'قيد المعالجة',
      CANCELED_BEFORE_ACTIVE: 'ملغاة قبل التفعيل',
      EDITED: 'معدّلة',
      SEND_IT_BACK: 'معادة للتعديل',
      UNKNOWN: 'غير معروفة',
    },
  },
  'freelance.issue_date': { labelAr: 'تاريخ إصدار الوثيقة', group: 'FREELANCE' },
  'freelance.expiry_date': { labelAr: 'تاريخ انتهاء الوثيقة', group: 'FREELANCE' },
  'freelance.speciality': { labelAr: 'التخصص', group: 'FREELANCE' },
  'freelance.category': { labelAr: 'الفئة', group: 'FREELANCE' },
  'person.name': { labelAr: 'الاسم', group: 'FREELANCE' },
  'person.nationality': { labelAr: 'الجنسية', group: 'FREELANCE' },
  'person.gender': {
    labelAr: 'الجنس',
    group: 'FREELANCE',
    values: { MALE: 'ذكر', FEMALE: 'أنثى', M: 'ذكر', F: 'أنثى' },
  },
  'person.national_id_expiry': { labelAr: 'انتهاء الهوية (هجري)', group: 'FREELANCE' },
  'property.status': {
    labelAr: 'حالة العقار في السجل',
    group: 'PROPERTY',
    values: { ACTIVE: 'فعّال', INACTIVE: 'غير فعّال', SUSPENDED: 'موقوف', TEMPORARY: 'مؤقت' },
  },
  'freelance.activity': { labelAr: 'نشاط العمل الحر', group: 'FREELANCE' },
  'freelance.expires_on': { labelAr: 'انتهاء وثيقة العمل الحر', group: 'FREELANCE' },
};

export const FIELD_GROUP_LABELS: Readonly<Record<FieldGroup, string>> = {
  REGISTRY: 'السجل التجاري',
  CONTRACT: 'عقد التأسيس',
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
  'CONTRACT',
  'ADDRESS',
  'GOVERNANCE',
  'OWNERSHIP',
  'BANKING',
  'INCOME',
  'PROPERTY',
  'FREELANCE',
  'OTHER',
];

/**
 * A field recorded under a path that carries the company it is true in, such as
 * manager.permissions.<company id>, is the same field wherever it appears: this finds its
 * definition by the path without that last segment.
 */
const UUID_SUFFIX = /\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function definitionOf(fieldPath: string): FieldDefinition | undefined {
  const general = fieldPath.replace(UUID_SUFFIX, '');
  return FIELD_CATALOGUE[fieldPath] ?? FIELD_CATALOGUE[general] ?? RELATIONSHIP_FIELDS[general];
}

export function fieldLabelAr(fieldPath: string): string {
  return definitionOf(fieldPath)?.labelAr ?? fieldPath;
}

export function isHiddenField(fieldPath: string): boolean {
  return definitionOf(fieldPath)?.hidden ?? false;
}

/** The words for a value, where the authority answered in a vocabulary of its own. */
export function valueLabelAr(fieldPath: string, value: unknown): string | null {
  const values = definitionOf(fieldPath)?.values;
  if (!values) {
    return null;
  }
  return values[String(value)] ?? null;
}

/**
 * An unknown field lands in "other" rather than being hidden.
 *
 * A product added as rows (rule 8) can produce a field path nobody has labelled yet, and
 * the wrong answer is to drop it: a verified fact that does not appear is worse than one
 * that appears under its raw name.
 */
export function fieldGroup(fieldPath: string): FieldGroup {
  return definitionOf(fieldPath)?.group ?? 'OTHER';
}

export function isNumericField(fieldPath: string): boolean {
  return definitionOf(fieldPath)?.numeric ?? false;
}

/** The facts recorded about a person only within one company. */
export const RELATIONSHIP_FIELDS: Readonly<Record<string, FieldDefinition>> = {
  'manager.positions': { labelAr: 'المنصب', group: 'GOVERNANCE' },
  'manager.permissions': { labelAr: 'الصلاحيات', group: 'GOVERNANCE' },
  'partner.roles': { labelAr: 'الصفة', group: 'CONTRACT' },
  'partner.shares': { labelAr: 'الحصص', group: 'CONTRACT', numeric: true },
  'partner.profit_pct': { labelAr: 'نسبة الأرباح', group: 'CONTRACT', numeric: true },
  'account.ownership': {
    labelAr: 'مطابقة الملكية',
    group: 'BANKING',
    values: { MATCH: 'مطابق', PARTIAL: 'تطابق جزئي', NO_MATCH: 'غير مطابق' },
  },
  'account.bank': { labelAr: 'البنك', group: 'BANKING' },
};
