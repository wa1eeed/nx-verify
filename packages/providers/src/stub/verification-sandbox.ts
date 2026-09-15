import {
  BENEFICIARY_ACTIVE,
  BENEFICIARY_BLOCKED,
  CORPORATE_ADDRESS,
  CORPORATE_CONTRACT,
  CORPORATE_FULL,
  CORPORATE_MANAGER,
  CORPORATE_NOT_FOUND,
  FREELANCER_ACTIVE,
  FREELANCER_CANCELED,
  FREELANCER_NOT_VERIFIED,
  IBAN_INACTIVE,
  IBAN_MATCH,
  IBAN_NAME_PARTIAL,
  IBAN_UNSUPPORTED_BANK,
} from '../lean/sandbox/fixtures.js';

/**
 * The sandbox for the verification products, answering in the data source's own shape.
 *
 * Every answer here is a recorded example from the data source's specification, or that
 * example with one thing changed to make a case a developer needs to see: a suspended
 * registration, a sole establishment with no articles, an account in another name. The
 * answer then goes through the same mapping a live answer goes through, so what a sandbox
 * shows is what production will show, field for field.
 *
 * The cases are published on the developer screen as a table, because "send something and
 * see" is not a test plan.
 */

type Payload = Record<string, unknown>;

const clone = (value: Payload): Payload => structuredClone(value);

function withVerifications(base: Payload, change: (verifications: Payload) => void): Payload {
  const copy = clone(base);
  const verifications = copy['verifications'];
  if (verifications && typeof verifications === 'object' && !Array.isArray(verifications)) {
    change(verifications as Payload);
  }
  return copy;
}

const SOURCE_DOWN: Payload = {
  status: 'FAILED',
  message: 'Something went wrong',
  status_detail: { granular_status_code: 'BANK_ISSUE', status_additional_info: null },
};

export const SANDBOX_UNN = {
  ACTIVE: '7001272184',
  SUSPENDED: '7001272185',
  ESTABLISHMENT: '7001272186',
  IN_LIQUIDATION: '7001272187',
  SOURCE_DOWN: '7001272188',
  NOT_FOUND: '7000000000',
} as const;

function suspended(base: Payload): Payload {
  return withVerifications(active(base), (v) => {
    v['status'] = { id: 2, ar: 'معلق', en: null };
    v['company_name'] = { ar: 'شركة اختبار موقوفة للتجارة', en: null };
    v['suspension_date'] = { gregorian: '2026-06-01', hijri: '1447-12-15' };
  });
}

function establishment(base: Payload): Payload {
  return withVerifications(active(base), (v) => {
    v['company_name'] = { ar: 'مؤسسة اختبار للمقاولات', en: null };
    v['entity_type'] = {
      id: 5,
      name: { ar: 'مؤسسة فردية', en: null },
      form_id: 5,
      form_name: { ar: 'مؤسسة فردية', en: null },
      characters: [],
    };
    v['commercial_registration_capital'] = 50000;
    v['parties'] = null;
  });
}

function inLiquidation(base: Payload): Payload {
  return withVerifications(active(base), (v) => {
    v['company_name'] = { ar: 'شركة اختبار تحت التصفية', en: null };
    v['status'] = { id: 5, ar: 'تحت التصفية', en: null };
    v['in_liquidation_process'] = true;
    // The recorded liquidator, which only a company in liquidation has.
    v['liquidators'] = structuredClone(recorded(CORPORATE_FULL)['liquidators'] ?? null);
  });
}

/**
 * The recorded example fills every field, including a suspension and a deletion date on a
 * company whose status is active, and a liquidator. A sandbox that answers that way teaches a
 * developer that the dates mean nothing, so the active company here has none of them.
 */
function active(base: Payload): Payload {
  return withVerifications(base, (v) => {
    v['suspension_date'] = null;
    v['deletion_date'] = null;
    v['reactivation_date'] = null;
    v['liquidators'] = null;
  });
}

/**
 * The recorded address with a second one registered beside it, a branch, so a developer sees
 * a business with more than one address and which of them is its primary.
 */
function withSecondAddress(base: Payload): Payload {
  return withVerifications(base, (v) => {
    const addresses = Array.isArray(v['addresses']) ? (v['addresses'] as Payload[]) : [];
    const first = addresses[0];
    if (first) {
      addresses.push({
        ...structuredClone(first),
        title: 'فرع مطعم ومعجنات السندباد',
        address: '3120 طريق الأمير محمد بن سلمان - حي الملقا',
        address2: 'الرياض 13521 - 7811',
        latitude: '24.80563712',
        longitude: '46.61032418',
        building_number: '3120',
        street: 'طريق الأمير محمد بن سلمان',
        district: 'حي الملقا',
        post_code: '13521',
        additional_number: '7811',
        is_primary_address: 'false',
        unit_number: '4',
        pk_address_id: '1352131207811',
      });
    }
  });
}

function recorded(base: Payload): Payload {
  const verifications = base['verifications'];
  return verifications && typeof verifications === 'object' && !Array.isArray(verifications)
    ? (verifications as Payload)
    : {};
}

/**
 * The full record with the boards the articles example records.
 *
 * The specification's full example leaves both boards empty though the full record carries
 * them, so a developer would never see a board drawn. The company's boards are the same in
 * both answers, which is what a real registry says.
 */
function withBoards(base: Payload): Payload {
  return withVerifications(base, (v) => {
    const management = v['management'];
    const recordedManagement = recorded(CORPORATE_CONTRACT)['management'];
    if (
      management &&
      typeof management === 'object' &&
      recordedManagement &&
      typeof recordedManagement === 'object'
    ) {
      const from = recordedManagement as Payload;
      const to = management as Payload;
      to['management_board'] = structuredClone(from['management_board'] ?? null);
      to['directors_board'] = structuredClone(from['directors_board'] ?? null);
      to['dismissal_method'] = structuredClone(from['dismissal_method'] ?? null);
    }
  });
}

function corporateAnswer(type: 'FULL' | 'CONTRACT' | 'ADDRESS', unn: string): Payload {
  const base =
    type === 'FULL'
      ? withBoards(CORPORATE_FULL)
      : type === 'CONTRACT'
        ? CORPORATE_CONTRACT
        : CORPORATE_ADDRESS;
  switch (unn) {
    case SANDBOX_UNN.ACTIVE:
      return type === 'ADDRESS' ? withSecondAddress(base) : active(base);
    case SANDBOX_UNN.SUSPENDED:
      // Shares its manager with the active company, so the link between the two appears in
      // both files the moment both are verified.
      return type === 'ADDRESS' ? clone(base) : suspended(base);
    case SANDBOX_UNN.ESTABLISHMENT:
      // A sole establishment has no articles of association. It shares the active
      // company's national address, which is the other link a sandbox should show.
      return type === 'CONTRACT' ? clone(CORPORATE_NOT_FOUND) : establishment(base);
    case SANDBOX_UNN.IN_LIQUIDATION:
      return type === 'ADDRESS' ? clone(CORPORATE_NOT_FOUND) : inLiquidation(base);
    case SANDBOX_UNN.SOURCE_DOWN:
      return clone(SOURCE_DOWN);
    default:
      return clone(CORPORATE_NOT_FOUND);
  }
}

export const SANDBOX_MANAGER_ID = '1234567890';

function managerAnswer(unn: string, managerId: string): Payload {
  if (unn === SANDBOX_UNN.SOURCE_DOWN) {
    return clone(SOURCE_DOWN);
  }
  const known = [SANDBOX_UNN.ACTIVE, SANDBOX_UNN.SUSPENDED, SANDBOX_UNN.ESTABLISHMENT] as string[];
  if (!known.includes(unn) || managerId !== SANDBOX_MANAGER_ID) {
    return clone(CORPORATE_NOT_FOUND);
  }
  return clone(CORPORATE_MANAGER);
}

export const SANDBOX_FREELANCER = {
  NATIONAL_ID: '1107454009',
  ACTIVE: 'FL-013988291',
  EXPIRED: 'FL-541440269',
  CANCELED: 'FL-090302137',
  OTHER_PERSON_ID: '1046403927',
} as const;

function freelancerAnswer(nationalId: string, certificate: string): Payload {
  if (nationalId !== SANDBOX_FREELANCER.NATIONAL_ID) {
    return clone(FREELANCER_NOT_VERIFIED);
  }
  if (certificate === SANDBOX_FREELANCER.CANCELED) {
    return clone(FREELANCER_CANCELED);
  }
  if (certificate === SANDBOX_FREELANCER.EXPIRED) {
    return withVerifications(FREELANCER_ACTIVE, (v) => {
      const certificates = Array.isArray(v['certificate']) ? (v['certificate'] as Payload[]) : [];
      const first = certificates[0];
      if (first) {
        first['status'] = 'EXPIRED';
        first['number'] = SANDBOX_FREELANCER.EXPIRED;
        first['expiry_date'] = '2025-01-31';
      }
    });
  }
  if (certificate === SANDBOX_FREELANCER.ACTIVE) {
    return withVerifications(FREELANCER_ACTIVE, (v) => {
      const certificates = Array.isArray(v['certificate']) ? (v['certificate'] as Payload[]) : [];
      const first = certificates[0];
      if (first) {
        // Recorded with a date that has since passed. A sandbox that answers ACTIVE with an
        // expiry in the past teaches a developer to ignore the date.
        first['expiry_date'] = '2027-08-21';
      }
    });
  }
  return clone(FREELANCER_NOT_VERIFIED);
}

export const SANDBOX_IBAN = {
  MATCH: 'SA2810000011100000461309',
  OTHER_NAME: 'SA0380000000608010167519',
  BLOCKED: 'SA4420000001234567891234',
  UNSUPPORTED_BANK: 'SA5510000000000000000001',
} as const;

function ibanAnswer(iban: string): Payload {
  switch (iban) {
    case SANDBOX_IBAN.MATCH:
      return clone(IBAN_MATCH);
    case SANDBOX_IBAN.BLOCKED:
      return clone(IBAN_INACTIVE);
    case SANDBOX_IBAN.UNSUPPORTED_BANK:
      return clone(IBAN_UNSUPPORTED_BANK);
    default:
      return clone(IBAN_NAME_PARTIAL);
  }
}

function beneficiaryAnswer(iban: string): Payload {
  if (iban === SANDBOX_IBAN.UNSUPPORTED_BANK) {
    return clone(IBAN_UNSUPPORTED_BANK);
  }
  return clone(iban === SANDBOX_IBAN.BLOCKED ? BENEFICIARY_BLOCKED : BENEFICIARY_ACTIVE);
}

/** The raw answer the sandbox gives for one call, before any mapping. */
export function sandboxVerificationAnswer(
  endpoint: string,
  input: Readonly<Record<string, unknown>>,
): Payload | null {
  const unn = String(input['unn'] ?? '');
  switch (endpoint) {
    case 'corporate_full':
      return corporateAnswer('FULL', unn);
    case 'corporate_contract':
      return corporateAnswer('CONTRACT', unn);
    case 'corporate_address':
      return corporateAnswer('ADDRESS', unn);
    case 'corporate_manager':
      return managerAnswer(unn, String(input['manager_id'] ?? ''));
    case 'freelancer_verification':
      return freelancerAnswer(
        String(input['national_id'] ?? ''),
        String(input['certificate_number'] ?? ''),
      );
    case 'iban_verification':
      return ibanAnswer(String(input['iban'] ?? ''));
    case 'iban_beneficiary_name':
      return beneficiaryAnswer(String(input['iban'] ?? ''));
    case 'property_verification':
      return clone(CORPORATE_NOT_FOUND);
    default:
      return null;
  }
}

export interface VerificationSandboxCase {
  /** What the developer types. Several inputs are joined with " + ". */
  input: string;
  productCode: string;
  titleAr: string;
  expectedAr: string;
}

/** The published table of sandbox cases for the verification products. */
export const VERIFICATION_SANDBOX_CASES: readonly VerificationSandboxCase[] = [
  {
    input: SANDBOX_UNN.ACTIVE,
    productCode: 'CR_FULL',
    titleAr: 'شركة قائمة',
    expectedAr: 'سجل فعّال، بمدير وشريك ونشاطين',
  },
  {
    input: SANDBOX_UNN.SUSPENDED,
    productCode: 'CR_FULL',
    titleAr: 'سجل موقوف',
    expectedAr: 'الحالة معلق، ويشارك الشركة القائمة مديرها',
  },
  {
    input: SANDBOX_UNN.ESTABLISHMENT,
    productCode: 'CR_FULL',
    titleAr: 'مؤسسة فردية',
    expectedAr: 'تصنيف مؤسسة، وبلا عقد تأسيس',
  },
  {
    input: SANDBOX_UNN.IN_LIQUIDATION,
    productCode: 'CR_FULL',
    titleAr: 'شركة تحت التصفية',
    expectedAr: 'مؤشر مخاطر مرتفع',
  },
  {
    input: SANDBOX_UNN.NOT_FOUND,
    productCode: 'CR_FULL',
    titleAr: 'رقم غير مسجل',
    expectedAr: 'لا توجد بيانات لدى الجهة',
  },
  {
    input: SANDBOX_UNN.SOURCE_DOWN,
    productCode: 'CR_FULL',
    titleAr: 'تعذّر الوصول للمصدر',
    expectedAr: 'خطأ بلا رسم، ويمكن إعادة المحاولة',
  },
  {
    input: SANDBOX_UNN.ACTIVE,
    productCode: 'ARTICLES_OF_ASSOCIATION',
    titleAr: 'عقد تأسيس',
    expectedAr: 'الشركاء وحصصهم وقرارات الشركاء',
  },
  {
    input: SANDBOX_UNN.ACTIVE,
    productCode: 'NATIONAL_ADDRESS',
    titleAr: 'عنوان وطني',
    expectedAr: 'مبنى وشارع وحي ورمز بريدي',
  },
  {
    input: `${SANDBOX_UNN.ACTIVE} + ${SANDBOX_MANAGER_ID}`,
    productCode: 'MANAGER_AUTHORITY',
    titleAr: 'صلاحيات مدير',
    expectedAr: 'إصدار توكيل منفرداً، وتوقيع العقود مجتمعين',
  },
  {
    input: `${SANDBOX_FREELANCER.NATIONAL_ID} + ${SANDBOX_FREELANCER.ACTIVE}`,
    productCode: 'FREELANCE_CERTIFICATE',
    titleAr: 'وثيقة سارية',
    expectedAr: 'ملكية الوثيقة موثّقة، والحالة سارية',
  },
  {
    input: `${SANDBOX_FREELANCER.NATIONAL_ID} + ${SANDBOX_FREELANCER.EXPIRED}`,
    productCode: 'FREELANCE_CERTIFICATE',
    titleAr: 'وثيقة منتهية',
    expectedAr: 'الحالة منتهية',
  },
  {
    input: `${SANDBOX_FREELANCER.OTHER_PERSON_ID} + ${SANDBOX_FREELANCER.ACTIVE}`,
    productCode: 'FREELANCE_CERTIFICATE',
    titleAr: 'هوية لا تملك الوثيقة',
    expectedAr: 'ملكية الوثيقة غير موثّقة',
  },
  {
    input: SANDBOX_IBAN.MATCH,
    productCode: 'IBAN_VERIFICATION',
    titleAr: 'آيبان مطابق',
    expectedAr: 'مطابق، والحساب نشط',
  },
  {
    input: SANDBOX_IBAN.OTHER_NAME,
    productCode: 'IBAN_VERIFICATION',
    titleAr: 'آيبان باسم آخر',
    expectedAr: 'تطابق جزئي في الاسم',
  },
  {
    input: SANDBOX_IBAN.BLOCKED,
    productCode: 'IBAN_VERIFICATION',
    titleAr: 'حساب موقوف',
    expectedAr: 'غير مطابق، والحساب محظور',
  },
  {
    input: SANDBOX_IBAN.UNSUPPORTED_BANK,
    productCode: 'IBAN_VERIFICATION',
    titleAr: 'بنك غير مدعوم',
    expectedAr: 'خطأ بلا رسم',
  },
];
