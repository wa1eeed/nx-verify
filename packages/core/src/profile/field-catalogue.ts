/**
 * What a field is called, which part of a file it belongs to, and how its value reads.
 *
 * One table, in the domain, because the same answers are needed by the evidence document, by
 * the entity file in the console, and by anything that lists a profile. Two copies of this
 * drift within a month, and the drift shows up as a field labelled one way on screen and
 * another way on the document a customer hands to their auditor.
 *
 * The groups are the tabs of an entity file. They are chosen by what a reader is looking
 * for rather than by which product produced the field: somebody checking a company's
 * banking arrangements wants the account, the holder and the income together, whether
 * they arrived from one product or three.
 *
 * The order of this table is the order a section lists its facts in. A long section is split
 * into parts under small headings (its registration, its dates, its capital), and a fact that
 * only makes sense beside another (a Hijri date beside its Gregorian one, an activity's code
 * beside its name) is drawn inside that other fact's cell rather than as a line of its own.
 */

export type FieldGroup =
  | 'REGISTRY'
  | 'PERSON'
  | 'CONTRACT'
  | 'ADDRESS'
  | 'GOVERNANCE'
  | 'OWNERSHIP'
  | 'BANKING'
  | 'INCOME'
  | 'PROPERTY'
  | 'FREELANCE'
  | 'OTHER';

/** How a value reads beyond its type. */
export type FieldFormat =
  /** A Gregorian date, 2002-10-05. */
  | 'date'
  /** A Hijri date, 1423-07-28, read with «هـ». */
  | 'hijri'
  /** A moment, of which the day is shown. */
  | 'datetime'
  /** Riyals. */
  | 'money'
  | 'percent'
  /** A term in years. */
  | 'years'
  | 'url'
  | 'email'
  | 'phone'
  /** A code or number read as written, left to right. */
  | 'code'
  /** A day of the year, 12-30, read as «30 ديسمبر». */
  | 'month_day'
  /** A latitude, with its longitude as a companion, read as a place on a map. */
  | 'coordinates'
  /** A list of records, drawn as a small table with the columns below. */
  | 'records'
  /** The articles of association, grouped by their part. */
  | 'articles';

/** One column of a list of records. */
export interface ListColumn {
  key: string;
  labelAr: string;
  format?: FieldFormat;
  values?: Readonly<Record<string, string>>;
}

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
  /** The part of its section the fact sits in, under a small heading. */
  part?: FieldPart;
  format?: FieldFormat;
  /** Drawn inside this other fact's cell when both are present. */
  companionOf?: string;
  /** For a list of records: its columns, in order. */
  columns?: readonly ListColumn[];
}

/** The parts a long section is split into, each under its own heading. */
export type FieldPart =
  | 'registration'
  | 'person'
  | 'dates'
  | 'capital'
  | 'activity'
  | 'contact'
  | 'fiscal'
  | 'liquidation'
  | 'contract'
  | 'profits'
  | 'decisions'
  | 'management'
  | 'managers'
  | 'management_board'
  | 'directors_board'
  | 'partners'
  | 'articles'
  | 'address'
  | 'other_addresses'
  | 'bank'
  | 'certificate'
  | 'speciality'
  | 'other_certificates';

export const PART_LABELS: Readonly<Record<FieldPart, string>> = {
  registration: 'بيانات السجل',
  person: 'البيانات الشخصية',
  dates: 'التواريخ',
  capital: 'رأس المال',
  activity: 'النشاط والتجارة الإلكترونية',
  contact: 'بيانات التواصل',
  fiscal: 'السنة المالية',
  liquidation: 'التصفية',
  contract: 'بيانات العقد',
  profits: 'الأرباح والاحتياطي',
  decisions: 'قرارات الشركاء',
  management: 'الإدارة',
  managers: 'المدراء',
  management_board: 'مجلس المديرين',
  directors_board: 'مجلس الإدارة',
  partners: 'الشركاء',
  articles: 'مواد العقد',
  address: 'العنوان الرئيسي',
  other_addresses: 'العناوين الأخرى',
  bank: 'الحساب البنكي',
  certificate: 'الوثيقة',
  speciality: 'التخصص',
  other_certificates: 'وثائق أخرى',
};

const YES_NO = { true: 'نعم', false: 'لا' } as const;

const CERTIFICATE_STATUS = {
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
} as const;

const ACCOUNT_STATUS = {
  ACTIVE: 'نشط',
  BLOCKED: 'محظور',
  INACTIVE: 'غير نشط',
  CLOSED: 'مغلق',
  DORMANT: 'راكد',
  IN_LIQUIDATION: 'تحت التصفية',
} as const;

const VERIFICATION_METHOD = {
  SARIE: 'نظام سريع',
  CONFIRMATION_OF_PAYEE_SERVICE: 'خدمة التحقق من المستفيد',
  OPEN_BANKING: 'المصرفية المفتوحة',
  SARIE_AND_CONFIRMATION_OF_PAYEE_SERVICE: 'سريع وخدمة التحقق من المستفيد',
} as const;

/** A board's facts, under the prefix of the product that read them. */
function boardFields(
  prefix: 'governance' | 'contract',
  group: FieldGroup,
): Record<string, FieldDefinition> {
  const managers = { group, part: 'management_board' } as const;
  const directors = { group, part: 'directors_board' } as const;
  return {
    [`${prefix}.management_board.quorum`]: { ...managers, labelAr: 'نصاب اجتماع المجلس' },
    [`${prefix}.management_board.can_delegate_attendance`]: {
      ...managers,
      labelAr: 'جواز الإنابة في الحضور',
      values: YES_NO,
    },
    [`${prefix}.management_board.term_years`]: {
      ...managers,
      labelAr: 'مدة المجلس',
      format: 'years',
    },
    [`${prefix}.management_board.way_of_work`]: { ...managers, labelAr: 'آلية عمل المجلس' },
    [`${prefix}.management_board.meeting_place`]: { ...managers, labelAr: 'مكان الاجتماع' },
    [`${prefix}.management_board.positions`]: { ...managers, labelAr: 'مناصب المجلس' },
    [`${prefix}.management_board.additional_text`]: { ...managers, labelAr: 'أحكام إضافية' },
    [`${prefix}.directors_board.member_count`]: {
      ...directors,
      labelAr: 'عدد أعضاء مجلس الإدارة',
      numeric: true,
    },
    [`${prefix}.directors_board.term_years`]: {
      ...directors,
      labelAr: 'مدة المجلس',
      format: 'years',
    },
    [`${prefix}.directors_board.quorum`]: {
      ...directors,
      labelAr: 'نصاب الاجتماع',
      numeric: true,
    },
    [`${prefix}.directors_board.legal_quorum`]: {
      ...directors,
      labelAr: 'النصاب النظامي',
      numeric: true,
    },
    [`${prefix}.directors_board.can_delegate_attendance`]: {
      ...directors,
      labelAr: 'جواز الإنابة في الحضور',
      values: YES_NO,
    },
    [`${prefix}.directors_board.way_of_work`]: { ...directors, labelAr: 'آلية عمل المجلس' },
    [`${prefix}.directors_board.meeting_place`]: { ...directors, labelAr: 'مكان الاجتماع' },
    [`${prefix}.directors_board.call_mechanism`]: {
      ...directors,
      labelAr: 'آلية دعوة المجلس',
    },
    [`${prefix}.directors_board.membership_expiry_terms`]: {
      ...directors,
      labelAr: 'انتهاء العضوية',
    },
    [`${prefix}.directors_board.reward_value`]: {
      ...directors,
      labelAr: 'مكافأة العضو',
      format: 'money',
    },
    [`${prefix}.directors_board.reward_max`]: {
      ...directors,
      labelAr: 'الحد الأعلى للمكافأة',
      format: 'money',
    },
    [`${prefix}.directors_board.rewards`]: { ...directors, labelAr: 'أنواع المكافآت' },
    [`${prefix}.directors_board.positions`]: { ...directors, labelAr: 'مناصب المجلس' },
    [`${prefix}.directors_board.additional_text`]: { ...directors, labelAr: 'أحكام إضافية' },
  };
}

/** A company's capital as the registry breaks it down, under the product's prefix. */
function capitalFields(
  prefix: 'cr' | 'contract',
  group: FieldGroup,
): Record<string, FieldDefinition> {
  const capital = { group, part: 'capital' } as const;
  return {
    [`${prefix}.capital_currency`]: { ...capital, labelAr: 'عملة رأس المال' },
    [`${prefix}.capital_type`]: { ...capital, labelAr: 'نوع رأس المال' },
    [`${prefix}.cash_capital`]: { ...capital, labelAr: 'رأس المال النقدي', format: 'money' },
    [`${prefix}.in_kind_capital`]: { ...capital, labelAr: 'رأس المال العيني', format: 'money' },
    [`${prefix}.share_value`]: { ...capital, labelAr: 'قيمة الحصة', format: 'money' },
    [`${prefix}.cash_shares`]: { ...capital, labelAr: 'عدد الحصص النقدية', numeric: true },
    [`${prefix}.in_kind_shares`]: { ...capital, labelAr: 'عدد الحصص العينية', numeric: true },
    [`${prefix}.stock_type`]: { ...capital, labelAr: 'نوع رأس مال الأسهم' },
    [`${prefix}.stock_capital`]: { ...capital, labelAr: 'رأس مال الأسهم', format: 'money' },
    [`${prefix}.announced_capital`]: { ...capital, labelAr: 'رأس المال المُعلن', format: 'money' },
    [`${prefix}.paid_capital`]: { ...capital, labelAr: 'رأس المال المدفوع', format: 'money' },
    [`${prefix}.stock_cash`]: { ...capital, labelAr: 'الأسهم النقدية', format: 'money' },
    [`${prefix}.stock_in_kind`]: { ...capital, labelAr: 'الأسهم العينية', format: 'money' },
    [`${prefix}.stocks`]: {
      ...capital,
      labelAr: 'فئات الأسهم',
      format: 'records',
      columns: [
        { key: 'class_name', labelAr: 'الفئة' },
        { key: 'type', labelAr: 'النوع' },
        { key: 'count', labelAr: 'عدد الأسهم', format: 'code' },
        { key: 'value', labelAr: 'القيمة الاسمية', format: 'money' },
      ],
    },
  };
}

export const FIELD_CATALOGUE: Readonly<Record<string, FieldDefinition>> = {
  // ─── The registration ───
  'cr.core.name': { labelAr: 'اسم المنشأة', group: 'REGISTRY', part: 'registration' },
  'cr.core.name_en': {
    labelAr: 'الاسم بالإنجليزية',
    group: 'REGISTRY',
    part: 'registration',
    companionOf: 'cr.core.name',
  },
  'cr.status': { labelAr: 'حالة السجل التجاري', group: 'REGISTRY', part: 'registration' },
  'cr.status_code': { labelAr: 'رمز حالة السجل', group: 'REGISTRY', hidden: true },
  'cr.kind': {
    labelAr: 'التصنيف',
    group: 'REGISTRY',
    hidden: true,
    values: { COMPANY: 'شركة', ESTABLISHMENT: 'مؤسسة' },
  },
  'cr.entity_type': { labelAr: 'نوع الكيان', group: 'REGISTRY', part: 'registration' },
  'cr.legal_form': { labelAr: 'الشكل القانوني', group: 'REGISTRY', part: 'registration' },
  'cr.entity_characters': { labelAr: 'خصائص الكيان', group: 'REGISTRY', part: 'registration' },
  'cr.name_language': { labelAr: 'لغة الاسم', group: 'REGISTRY', part: 'registration' },
  'cr.version_number': {
    labelAr: 'رقم إصدار السجل',
    group: 'REGISTRY',
    part: 'registration',
    format: 'code',
  },
  'cr.is_main': { labelAr: 'سجل رئيسي', group: 'REGISTRY', part: 'registration', values: YES_NO },
  'cr.headquarters_city': { labelAr: 'المدينة الرئيسية', group: 'REGISTRY', part: 'registration' },
  'cr.license_based': {
    labelAr: 'صادر بناءً على ترخيص',
    group: 'REGISTRY',
    part: 'registration',
    values: YES_NO,
  },
  'cr.license_issuer': { labelAr: 'جهة الترخيص', group: 'REGISTRY', part: 'registration' },
  'cr.license_issuer_number': {
    labelAr: 'الرقم الوطني لجهة الترخيص',
    group: 'REGISTRY',
    part: 'registration',
    format: 'code',
  },
  'cr.partners_nationality': { labelAr: 'جنسية الشركاء', group: 'REGISTRY', part: 'registration' },

  // ─── Its dates ───
  'cr.issue_date': {
    labelAr: 'تاريخ إصدار السجل',
    group: 'REGISTRY',
    part: 'dates',
    format: 'date',
  },
  'cr.issue_date_hijri': {
    labelAr: 'تاريخ إصدار السجل (هجري)',
    group: 'REGISTRY',
    part: 'dates',
    format: 'hijri',
    companionOf: 'cr.issue_date',
  },
  'cr.established_on': {
    labelAr: 'تاريخ التأسيس',
    group: 'REGISTRY',
    part: 'dates',
    format: 'date',
  },
  'cr.confirmation_date': {
    labelAr: 'تاريخ تأكيد السجل',
    group: 'REGISTRY',
    part: 'dates',
    format: 'date',
  },
  'cr.confirmation_date_hijri': {
    labelAr: 'تاريخ تأكيد السجل (هجري)',
    group: 'REGISTRY',
    part: 'dates',
    format: 'hijri',
    companionOf: 'cr.confirmation_date',
  },
  'cr.reactivation_date': {
    labelAr: 'تاريخ إعادة التفعيل',
    group: 'REGISTRY',
    part: 'dates',
    format: 'date',
  },
  'cr.reactivation_date_hijri': {
    labelAr: 'تاريخ إعادة التفعيل (هجري)',
    group: 'REGISTRY',
    part: 'dates',
    format: 'hijri',
    companionOf: 'cr.reactivation_date',
  },
  'cr.suspension_date': {
    labelAr: 'تاريخ الإيقاف',
    group: 'REGISTRY',
    part: 'dates',
    format: 'date',
  },
  'cr.suspension_date_hijri': {
    labelAr: 'تاريخ الإيقاف (هجري)',
    group: 'REGISTRY',
    part: 'dates',
    format: 'hijri',
    companionOf: 'cr.suspension_date',
  },
  'cr.deletion_date': { labelAr: 'تاريخ الشطب', group: 'REGISTRY', part: 'dates', format: 'date' },
  'cr.deletion_date_hijri': {
    labelAr: 'تاريخ الشطب (هجري)',
    group: 'REGISTRY',
    part: 'dates',
    format: 'hijri',
    companionOf: 'cr.deletion_date',
  },

  // ─── Its capital ───
  'cr.core.capital': {
    labelAr: 'رأس المال',
    group: 'REGISTRY',
    part: 'capital',
    numeric: true,
    format: 'money',
  },
  ...capitalFields('cr', 'REGISTRY'),

  // ─── What it does and where it sells ───
  'cr.activities': { labelAr: 'الأنشطة', group: 'REGISTRY', part: 'activity' },
  'cr.activity_codes': {
    labelAr: 'رموز الأنشطة',
    group: 'REGISTRY',
    part: 'activity',
    companionOf: 'cr.activities',
  },
  'cr.has_ecommerce': {
    labelAr: 'متجر إلكتروني مسجّل',
    group: 'REGISTRY',
    part: 'activity',
    values: YES_NO,
  },
  'cr.e_stores': {
    labelAr: 'المتاجر الإلكترونية',
    group: 'REGISTRY',
    part: 'activity',
    format: 'records',
    columns: [
      { key: 'store_url', labelAr: 'رابط المتجر', format: 'url' },
      { key: 'platform_url', labelAr: 'رابط التوثيق', format: 'url' },
      { key: 'activities', labelAr: 'أنشطة المتجر' },
    ],
  },

  // ─── How to reach it ───
  'cr.contact.phone': { labelAr: 'الهاتف', group: 'REGISTRY', part: 'contact', format: 'phone' },
  'cr.contact.mobile': { labelAr: 'الجوال', group: 'REGISTRY', part: 'contact', format: 'phone' },
  'cr.contact.email': {
    labelAr: 'البريد الإلكتروني',
    group: 'REGISTRY',
    part: 'contact',
    format: 'email',
  },
  'cr.website': { labelAr: 'الموقع الإلكتروني', group: 'REGISTRY', part: 'contact', format: 'url' },

  // ─── Its fiscal year ───
  'cr.fiscal_year_end': {
    labelAr: 'نهاية السنة المالية',
    group: 'REGISTRY',
    part: 'fiscal',
    format: 'month_day',
  },
  'cr.fiscal_year.calendar': {
    labelAr: 'تقويم السنة المالية',
    group: 'REGISTRY',
    part: 'fiscal',
    companionOf: 'cr.fiscal_year_end',
  },
  'cr.fiscal_year.is_first': {
    labelAr: 'السنة المالية الأولى',
    group: 'REGISTRY',
    part: 'fiscal',
    values: YES_NO,
  },
  'cr.fiscal_year.end_year': {
    labelAr: 'سنة انتهاء السنة المالية',
    group: 'REGISTRY',
    part: 'fiscal',
    format: 'code',
  },

  // ─── Liquidation ───
  'cr.in_liquidation': {
    labelAr: 'تحت التصفية',
    group: 'REGISTRY',
    part: 'liquidation',
    values: YES_NO,
  },
  'cr.liquidators_total': {
    labelAr: 'عدد المصفّين',
    group: 'REGISTRY',
    part: 'liquidation',
    numeric: true,
    hidden: true,
  },

  // ─── A person's own particulars ───
  'person.name': { labelAr: 'الاسم', group: 'PERSON', part: 'person' },
  'person.name_en': {
    labelAr: 'الاسم بالإنجليزية',
    group: 'PERSON',
    part: 'person',
    companionOf: 'person.name',
  },
  'person.nationality': { labelAr: 'الجنسية', group: 'PERSON', part: 'person' },
  'person.gender': {
    labelAr: 'الجنس',
    group: 'PERSON',
    part: 'person',
    values: { MALE: 'ذكر', FEMALE: 'أنثى', M: 'ذكر', F: 'أنثى' },
  },
  'person.national_id_expiry': {
    labelAr: 'تاريخ انتهاء الهوية',
    group: 'PERSON',
    part: 'person',
    format: 'hijri',
  },
  'party.identity_type': { labelAr: 'نوع وثيقة الهوية', group: 'PERSON', part: 'person' },
  'party.nationality': { labelAr: 'الجنسية', group: 'PERSON', part: 'person' },

  // ─── The articles of association ───
  'contract.copy_number': {
    labelAr: 'رقم نسخة العقد',
    group: 'CONTRACT',
    part: 'contract',
    format: 'code',
  },
  'contract.date': {
    labelAr: 'تاريخ عقد التأسيس',
    group: 'CONTRACT',
    part: 'contract',
    format: 'date',
  },
  'contract.articles_count': {
    labelAr: 'عدد مواد العقد',
    group: 'CONTRACT',
    part: 'contract',
    numeric: true,
  },
  'contract.partners_total': {
    labelAr: 'عدد الشركاء في العقد',
    group: 'CONTRACT',
    part: 'contract',
    numeric: true,
  },
  'contract.managers_total': {
    labelAr: 'عدد المدراء في العقد',
    group: 'CONTRACT',
    part: 'contract',
    numeric: true,
  },
  'contract.capital': {
    labelAr: 'رأس المال في العقد',
    group: 'CONTRACT',
    part: 'capital',
    numeric: true,
    format: 'money',
  },
  ...capitalFields('contract', 'CONTRACT'),
  'contract.profit_set_aside_pct': {
    labelAr: 'نسبة الاحتياطي من الأرباح',
    group: 'CONTRACT',
    part: 'profits',
    numeric: true,
    format: 'percent',
  },
  'contract.set_aside_enabled': {
    labelAr: 'تجنيب الاحتياطي',
    group: 'CONTRACT',
    part: 'profits',
    values: { true: 'مفعّل', false: 'غير مفعّل' },
  },
  'contract.set_aside_purpose': { labelAr: 'غرض الاحتياطي', group: 'CONTRACT', part: 'profits' },
  'contract.partner_decisions': {
    labelAr: 'قرارات الشركاء ونسب إقرارها',
    group: 'CONTRACT',
    part: 'decisions',
    format: 'records',
    columns: [
      { key: 'name', labelAr: 'القرار' },
      { key: 'approve_percentage', labelAr: 'نسبة الإقرار', format: 'percent' },
      { key: 'condition', labelAr: 'شرط الإقرار' },
    ],
  },
  'contract.additional_decision_text': {
    labelAr: 'أحكام إضافية للقرارات',
    group: 'CONTRACT',
    part: 'decisions',
  },
  'contract.notification_channels': {
    labelAr: 'وسائل إبلاغ الشركاء',
    group: 'CONTRACT',
    part: 'decisions',
  },
  'contract.management_structure': {
    labelAr: 'هيكل الإدارة في العقد',
    group: 'CONTRACT',
    part: 'management',
  },
  'contract.dismissal_method': {
    labelAr: 'طريقة عزل المدير',
    group: 'CONTRACT',
    part: 'management',
  },
  ...boardFields('contract', 'CONTRACT'),
  'contract.board_members': {
    labelAr: 'عدد أعضاء مجلس الإدارة',
    group: 'CONTRACT',
    part: 'directors_board',
    numeric: true,
  },
  'ownership.partners_total': {
    labelAr: 'عدد الشركاء',
    group: 'CONTRACT',
    part: 'partners',
    numeric: true,
  },
  'contract.articles': {
    labelAr: 'نصوص مواد العقد',
    group: 'CONTRACT',
    part: 'articles',
    format: 'articles',
  },

  // ─── Who runs it ───
  'governance.structure': { labelAr: 'هيكل الإدارة', group: 'GOVERNANCE', part: 'management' },
  'governance.managers_total': {
    labelAr: 'عدد المدراء',
    group: 'GOVERNANCE',
    part: 'management',
    numeric: true,
  },
  'governance.dismissal_method': {
    labelAr: 'طريقة عزل المدير',
    group: 'GOVERNANCE',
    part: 'management',
  },
  ...boardFields('governance', 'GOVERNANCE'),

  // ─── The national address ───
  'address.national.title': {
    labelAr: 'اسم المنشأة في العنوان',
    group: 'ADDRESS',
    part: 'address',
  },
  'address.national.line1': { labelAr: 'العنوان', group: 'ADDRESS', part: 'address' },
  'address.national.line2': { labelAr: 'تتمة العنوان', group: 'ADDRESS', part: 'address' },
  'address.national.city': { labelAr: 'المدينة', group: 'ADDRESS', part: 'address' },
  'address.national.district': { labelAr: 'الحي', group: 'ADDRESS', part: 'address' },
  'address.national.street': { labelAr: 'الشارع', group: 'ADDRESS', part: 'address' },
  'address.national.building_number': {
    labelAr: 'رقم المبنى',
    group: 'ADDRESS',
    part: 'address',
    format: 'code',
  },
  'address.national.postal_code': {
    labelAr: 'الرمز البريدي',
    group: 'ADDRESS',
    part: 'address',
    format: 'code',
  },
  'address.national.additional_number': {
    labelAr: 'الرقم الإضافي',
    group: 'ADDRESS',
    part: 'address',
    format: 'code',
  },
  'address.national.unit_number': {
    labelAr: 'رقم الوحدة',
    group: 'ADDRESS',
    part: 'address',
    format: 'code',
  },
  'address.national.region': { labelAr: 'المنطقة', group: 'ADDRESS', part: 'address' },
  'address.national.status': { labelAr: 'حالة العنوان', group: 'ADDRESS', part: 'address' },
  'address.national.restriction': { labelAr: 'قيود العنوان', group: 'ADDRESS', part: 'address' },
  'address.national.is_primary': {
    labelAr: 'العنوان الرئيسي للمنشأة',
    group: 'ADDRESS',
    part: 'address',
    values: YES_NO,
  },
  'address.national.latitude': {
    labelAr: 'الموقع على الخريطة',
    group: 'ADDRESS',
    part: 'address',
    format: 'coordinates',
  },
  'address.national.longitude': {
    labelAr: 'خط الطول',
    group: 'ADDRESS',
    part: 'address',
    companionOf: 'address.national.latitude',
  },
  'address.national.count': {
    labelAr: 'عدد العناوين المسجلة',
    group: 'ADDRESS',
    part: 'address',
    numeric: true,
  },
  'address.national.key': { labelAr: 'مفتاح المقارنة', group: 'ADDRESS', hidden: true },
  'address.national.others': {
    labelAr: 'العناوين الأخرى المسجلة',
    group: 'ADDRESS',
    part: 'other_addresses',
    format: 'records',
    columns: [
      { key: 'title', labelAr: 'الاسم' },
      { key: 'line1', labelAr: 'العنوان' },
      { key: 'line2', labelAr: 'تتمة العنوان' },
      { key: 'building_number', labelAr: 'المبنى', format: 'code' },
      { key: 'additional_number', labelAr: 'الرقم الإضافي', format: 'code' },
      { key: 'unit_number', labelAr: 'الوحدة', format: 'code' },
      { key: 'region', labelAr: 'المنطقة' },
      { key: 'status', labelAr: 'الحالة' },
      { key: 'restriction', labelAr: 'القيود' },
    ],
  },

  'manager.signing_authority': { labelAr: 'صلاحية التوقيع', group: 'GOVERNANCE' },
  'manager.signing_authority.verified': { labelAr: 'إثبات صلاحية التوقيع', group: 'GOVERNANCE' },

  'owner.percentage': { labelAr: 'نسبة الملكية', group: 'OWNERSHIP', numeric: true },

  // ─── Banking ───
  'bank.name': { labelAr: 'البنك', group: 'BANKING', part: 'bank' },
  'bank.name_en': {
    labelAr: 'اسم البنك بالإنجليزية',
    group: 'BANKING',
    part: 'bank',
    companionOf: 'bank.name',
  },
  'bank.account_status': {
    labelAr: 'حالة الحساب',
    group: 'BANKING',
    part: 'bank',
    values: ACCOUNT_STATUS,
  },
  'bank.holder_name': {
    labelAr: 'اسم صاحب الحساب كما يظهر لدى البنك',
    group: 'BANKING',
    part: 'bank',
  },
  'bank.iban_ownership': {
    labelAr: 'مطابقة ملكية الآيبان',
    group: 'BANKING',
    part: 'bank',
    values: { MATCH: 'مطابق', PARTIAL: 'تطابق جزئي في الاسم', NO_MATCH: 'غير مطابق' },
  },
  'bank.match_score': {
    labelAr: 'درجة تطابق الاسم',
    group: 'BANKING',
    part: 'bank',
    numeric: true,
  },
  'bank.swift_code': { labelAr: 'رمز السويفت', group: 'BANKING', part: 'bank', format: 'code' },
  'bank.code': { labelAr: 'رمز البنك', group: 'BANKING', part: 'bank', format: 'code' },
  'bank.verification_method': {
    labelAr: 'طريقة التأكيد',
    group: 'BANKING',
    part: 'bank',
    values: VERIFICATION_METHOD,
  },
  'bank.beneficiary_name': { labelAr: 'اسم المستفيد', group: 'BANKING', part: 'bank' },
  'iban.ownership': { labelAr: 'ملكية الآيبان', group: 'BANKING' },
  'iban.bank': { labelAr: 'البنك', group: 'BANKING' },
  'holder.name': { labelAr: 'اسم صاحب الحساب', group: 'BANKING' },
  'account.ownership': {
    labelAr: 'ملكية الحساب البنكي',
    group: 'BANKING',
    values: { MATCH: 'مطابق', PARTIAL: 'تطابق جزئي', NO_MATCH: 'غير مطابق' },
  },
  'account.status': { labelAr: 'حالة الحساب', group: 'BANKING', values: ACCOUNT_STATUS },
  'account.match_score': { labelAr: 'درجة مطابقة الاسم', group: 'BANKING', numeric: true },
  'account.holder_name': { labelAr: 'اسم صاحب الحساب كما يظهر لدى البنك', group: 'BANKING' },
  'account.swift_code': { labelAr: 'رمز السويفت', group: 'BANKING', format: 'code' },
  'account.bank_code': { labelAr: 'رمز البنك', group: 'BANKING', format: 'code' },
  'account.verification_method': {
    labelAr: 'طريقة التأكيد',
    group: 'BANKING',
    values: VERIFICATION_METHOD,
  },
  'holder.name_match': {
    labelAr: 'مطابقة اسم صاحب الحساب',
    group: 'BANKING',
    values: {
      MATCH: 'مطابق',
      PARTIAL_MATCH: 'تطابق جزئي',
      PARTIAL: 'تطابق جزئي',
      NO_MATCH: 'غير مطابق',
    },
  },
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
  'property.status': {
    labelAr: 'حالة العقار في السجل',
    group: 'PROPERTY',
    values: { ACTIVE: 'فعّال', INACTIVE: 'غير فعّال', SUSPENDED: 'موقوف', TEMPORARY: 'مؤقت' },
  },

  // ─── The freelance certificate ───
  'freelance.document': { labelAr: 'وثيقة العمل الحر', group: 'FREELANCE', part: 'certificate' },
  'freelance.certificate_status': {
    labelAr: 'حالة الوثيقة',
    group: 'FREELANCE',
    part: 'certificate',
    values: CERTIFICATE_STATUS,
  },
  'freelance.ownership': {
    labelAr: 'ملكية الوثيقة',
    group: 'FREELANCE',
    part: 'certificate',
    values: {
      VERIFIED: 'تعود لصاحب الهوية',
      NOT_VERIFIED: 'لا تعود لصاحب الهوية',
      NOT_CHECKED: 'لم تُفحص',
    },
  },
  'freelance.issue_date': {
    labelAr: 'تاريخ إصدار الوثيقة',
    group: 'FREELANCE',
    part: 'certificate',
    format: 'date',
  },
  'freelance.expiry_date': {
    labelAr: 'تاريخ انتهاء الوثيقة',
    group: 'FREELANCE',
    part: 'certificate',
    format: 'date',
  },
  'freelance.revoked_at': {
    labelAr: 'تاريخ سحب الوثيقة',
    group: 'FREELANCE',
    part: 'certificate',
    format: 'datetime',
  },
  'freelance.canceled_at': {
    labelAr: 'تاريخ إلغاء الوثيقة',
    group: 'FREELANCE',
    part: 'certificate',
    format: 'datetime',
  },
  'freelance.certificates_count': {
    labelAr: 'عدد الوثائق المسجلة للشخص',
    group: 'FREELANCE',
    part: 'certificate',
    numeric: true,
  },
  'freelance.speciality': { labelAr: 'التخصص', group: 'FREELANCE', part: 'speciality' },
  'freelance.speciality_code': {
    labelAr: 'رمز التخصص',
    group: 'FREELANCE',
    part: 'speciality',
    companionOf: 'freelance.speciality',
  },
  'freelance.speciality_en': {
    labelAr: 'التخصص بالإنجليزية',
    group: 'FREELANCE',
    part: 'speciality',
    companionOf: 'freelance.speciality',
  },
  'freelance.category': { labelAr: 'الفئة', group: 'FREELANCE', part: 'speciality' },
  'freelance.category_code': {
    labelAr: 'رمز الفئة',
    group: 'FREELANCE',
    part: 'speciality',
    companionOf: 'freelance.category',
  },
  'freelance.category_en': {
    labelAr: 'الفئة بالإنجليزية',
    group: 'FREELANCE',
    part: 'speciality',
    companionOf: 'freelance.category',
  },
  'freelance.other_certificates': {
    labelAr: 'الوثائق الأخرى للشخص',
    group: 'FREELANCE',
    part: 'other_certificates',
    format: 'records',
    columns: [
      { key: 'status', labelAr: 'الحالة', values: CERTIFICATE_STATUS },
      { key: 'speciality', labelAr: 'التخصص' },
      { key: 'category', labelAr: 'الفئة' },
      { key: 'issue_date', labelAr: 'الإصدار', format: 'date' },
      { key: 'expiry_date', labelAr: 'الانتهاء', format: 'date' },
    ],
  },
  'freelance.activity': { labelAr: 'نشاط العمل الحر', group: 'FREELANCE' },
  'freelance.expires_on': { labelAr: 'انتهاء وثيقة العمل الحر', group: 'FREELANCE' },
};

export const FIELD_GROUP_LABELS: Readonly<Record<FieldGroup, string>> = {
  REGISTRY: 'السجل التجاري',
  PERSON: 'البيانات الشخصية',
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
  'PERSON',
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

/** A fact true of somebody only within one company: its path ends with that company. */
export function isRelationshipPath(fieldPath: string): boolean {
  return UUID_SUFFIX.test(fieldPath);
}

/** The company a relationship fact is true in, or null for a fact of the entity itself. */
export function relationshipSubjectOf(fieldPath: string): string | null {
  const match = UUID_SUFFIX.exec(fieldPath);
  return match === null ? null : match[0].slice(1);
}

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
 * A value in plain words, whatever its shape, for the places that show a value as a line of
 * text: a field's past values, what a verification wrote, a document.
 *
 * Words for a coded value, «نعم» and «لا», a list joined by commas, and a list of records one
 * record per line with its columns' labels, never the raw JSON.
 */
export function valueWordsAr(fieldPath: string, value: unknown): string {
  const words = valueLabelAr(fieldPath, value);
  if (words !== null) {
    return words;
  }
  const definition = definitionOf(fieldPath);
  return plainWords(value, definition?.columns, definition?.format);
}

function plainWords(
  value: unknown,
  columns: readonly ListColumn[] | undefined,
  format: FieldFormat | undefined,
): string {
  if (value === null || value === undefined) {
    return 'غير متوفر';
  }
  if (typeof value === 'boolean') {
    return value ? 'نعم' : 'لا';
  }
  if (typeof value === 'number') {
    return format === 'percent' ? `${value}%` : String(value);
  }
  if (typeof value === 'string') {
    return format === 'hijri' ? `${value} هـ` : value;
  }
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === 'string' || typeof entry === 'number')) {
      return value.join('، ');
    }
    return value
      .map((entry) => {
        const record = (entry ?? {}) as Record<string, unknown>;
        if (format === 'articles') {
          const title = typeof record['title'] === 'string' ? `${record['title']}: ` : '';
          return `${title}${String(record['text'] ?? '')}`;
        }
        const keys = columns?.map((column) => column.key) ?? Object.keys(record);
        return keys
          .filter((key) => record[key] !== undefined && record[key] !== null)
          .map((key) => {
            const column = columns?.find((entry) => entry.key === key);
            const cell = record[key];
            const words =
              column?.values?.[String(cell)] ?? plainWords(cell, undefined, column?.format);
            return column ? `${column.labelAr}: ${words}` : words;
          })
          .join(' · ');
      })
      .join(' | ');
  }
  return JSON.stringify(value);
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

const CATALOGUE_ORDER = new Map(Object.keys(FIELD_CATALOGUE).map((path, index) => [path, index]));

/** Where a field comes in its section: the order of this table, unknown fields last. */
export function fieldOrder(fieldPath: string): number {
  const general = fieldPath.replace(UUID_SUFFIX, '');
  return CATALOGUE_ORDER.get(fieldPath) ?? CATALOGUE_ORDER.get(general) ?? Number.MAX_SAFE_INTEGER;
}

/** The facts recorded about somebody only within one company. */
export const RELATIONSHIP_FIELDS: Readonly<Record<string, FieldDefinition>> = {
  'manager.positions': { labelAr: 'المنصب', group: 'GOVERNANCE' },
  'manager.permissions': { labelAr: 'الصلاحيات', group: 'GOVERNANCE' },
  'manager.type': { labelAr: 'صفة المدير', group: 'GOVERNANCE' },
  'manager.licensed': { labelAr: 'مدير مرخّص', group: 'GOVERNANCE', values: YES_NO },
  'partner.type': { labelAr: 'نوع الشريك', group: 'CONTRACT' },
  'partner.roles': { labelAr: 'الصفة', group: 'CONTRACT' },
  'partner.shares': { labelAr: 'الحصص', group: 'CONTRACT', numeric: true },
  'partner.cash_shares': { labelAr: 'الحصص النقدية', group: 'CONTRACT', numeric: true },
  'partner.in_kind_shares': { labelAr: 'الحصص العينية', group: 'CONTRACT', numeric: true },
  'partner.profit_pct': {
    labelAr: 'نسبة الأرباح',
    group: 'CONTRACT',
    numeric: true,
    format: 'percent',
  },
  'partner.loss_pct': {
    labelAr: 'نسبة الخسائر',
    group: 'CONTRACT',
    numeric: true,
    format: 'percent',
  },
  'partner.license_number': { labelAr: 'رقم الترخيص', group: 'CONTRACT', format: 'code' },
  'partner.guardian': { labelAr: 'الولي', group: 'CONTRACT' },
  'liquidator.type': { labelAr: 'صفة المصفّي', group: 'REGISTRY' },
  'liquidator.positions': { labelAr: 'منصب المصفّي', group: 'REGISTRY' },
  'guardian.ward': { labelAr: 'ولي عن الشريك', group: 'CONTRACT' },
  'guardian.is_father': { labelAr: 'الولي هو الأب', group: 'CONTRACT', values: YES_NO },
  'registry.branches': { labelAr: 'فرع مسجّل', group: 'REGISTRY', values: YES_NO },
  'account.ownership': {
    labelAr: 'مطابقة الملكية',
    group: 'BANKING',
    values: { MATCH: 'مطابق', PARTIAL: 'تطابق جزئي', NO_MATCH: 'غير مطابق' },
  },
  'account.match_score': { labelAr: 'درجة مطابقة الاسم', group: 'BANKING', numeric: true },
  'account.bank': { labelAr: 'البنك', group: 'BANKING' },
};
