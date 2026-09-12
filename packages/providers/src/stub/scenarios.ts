import type { ProviderErrorCode } from '../types.js';

/**
 * Fixed responses for the stub provider.
 *
 * docs/00-START-HERE.md calls unit 3 critical, and this file is why: these five
 * scenarios let the whole platform be built and tested before any account exists with any
 * provider. Every one of them is a case that will happen in production, and each is a
 * case a demo would never show you.
 *
 * The trigger is the identifier, so a test picks a scenario by choosing an input rather
 * than by reaching into the provider and reconfiguring it.
 */

export type StubScenarioKind = 'OK' | 'NOT_FOUND' | 'NETWORK' | 'AUTH' | 'INCOMPLETE';

export interface StubScenario {
  kind: StubScenarioKind;
  errorCode?: ProviderErrorCode;
  retryable?: boolean;
  /** Keyed by endpoint. Absent for the failure scenarios. */
  data?: Record<string, Record<string, unknown>>;
}

/** Success. Every endpoint answers with a complete payload. */
const FULL_SUCCESS: StubScenario = {
  kind: 'OK',
  data: {
    business_verification: {
      unified_number: '7001272184',
      cr_number: '1010478213',
      cr_status: 'ACTIVE',
      company_name: 'شركة المثال للتجارة',
      capital: 500000,
      issue_date: '2019-03-14',
      city: 'الرياض',
      district: 'العليا',
      building_number: '2743',
      postal_code: '12211',
      additional_number: '8456',
    },
    articles_of_association: {
      unified_number: '7001272184',
      document_number: 'AOA-88213',
      managers: [
        {
          name: 'محمد عبدالله',
          id: '1098765432',
          id_type: 'NATIONAL_ID',
          signing_authority: 'SOLE',
          verified: true,
        },
      ],
    },
    manager_permissions: {
      unified_number: '7001272184',
      manager_id: '1098765432',
      signing_authority: 'SOLE',
      verified: true,
      scope: 'FULL',
    },
    ultimate_beneficial_owner: {
      unified_number: '7001272184',
      owners: [{ name: 'محمد عبدالله', id: '1098765432', percentage: 100 }],
    },
    iban_ownership: {
      iban: 'SA0380000000608010167519',
      match_result: 'MATCHED',
      account_holder_name: 'شركة المثال للتجارة',
      holder_identifier: '1010478213',
      bank_name: 'Example Bank',
    },
    property_deed: {
      deed_number: '310108046855',
      deed_status: 'ACTIVE',
      owner_name: 'شركة المثال للتجارة',
      owner_identifier: '1010478213',
      property_type: 'LAND',
      city: 'الرياض',
      district: 'النرجس',
      area_sqm: 1250,
      issue_date: '2021-02-11',
      encumbrances: [],
    },
    freelancer_certificate: {
      certificate_number: 'FL-2026-88213',
      freelancer_name: 'محمد عبدالله',
      certificate_status: 'ACTIVE',
      issue_date: '2025-06-01',
      expiry_date: '2027-06-01',
      activity: 'تطوير برمجيات',
    },
    // The open banking endpoints. They answer in our field names, because the adapter
    // that speaks the upstream vocabulary has already done its work by this point and the
    // stub stands in for what comes out of it, not for what goes into it.
    bank_account_ownership: {
      match_result: 'MATCH',
      account_holder_name: 'شركة المثال للتجارة',
      account_status: 'ACTIVE',
      account_currency: 'SAR',
      match_score: 0.97,
      verification_method: 'CONFIRMATION_OF_PAYEE_SERVICE',
    },
    name_match: {
      match_result: 'PERFECT_MATCH',
      name_provided: 'شركة المثال للتجارة',
      name_retrieved: 'شركة المثال للتجارة',
      match_confidence: 1,
    },
    income_verification: {
      income_currency: 'SAR',
      average_monthly_income: 18500,
      income_payment_count: 12,
      first_income_at: '2025-09-01T00:00:00Z',
      last_income_at: '2026-08-01T00:00:00Z',
    },
  },
};

/** The subject genuinely does not exist. Billed at negative_pct, not free, not an error. */
const NOT_FOUND: StubScenario = { kind: 'NOT_FOUND' };

/** The call never reached the authority. Never billed. */
const NETWORK_ERROR: StubScenario = {
  kind: 'NETWORK',
  errorCode: 'NETWORK',
  retryable: true,
};

/** Our credential was rejected. Never billed, and never retried blindly. */
const AUTH_ERROR: StubScenario = {
  kind: 'AUTH',
  errorCode: 'AUTH',
  retryable: false,
};

/**
 * The call succeeded and the payload is missing fields. This is the scenario that finds
 * bugs, because it is the one a provider's documentation never shows.
 */
const INCOMPLETE: StubScenario = {
  kind: 'INCOMPLETE',
  data: {
    business_verification: {
      unified_number: '7000000003',
      cr_status: 'ACTIVE',
      // No company name, no capital, no address. A real registry does this.
    },
    articles_of_association: {
      unified_number: '7000000003',
      managers: [],
    },
  },
};

/**
 * A registration that exists and has lapsed.
 *
 * The most common real answer after a clean one, and the one a customer most needs to see
 * before launch: the company is there, the file is complete, and the status means no.
 */
const EXPIRED_CR: StubScenario = {
  kind: 'OK',
  data: {
    business_verification: {
      unified_number: '7000000010',
      cr_number: '2020202020',
      cr_status: 'EXPIRED',
      company_name: 'شركة السجل المنتهي',
      capital: 100000,
      issue_date: '2016-01-10',
      city: 'جدة',
      district: 'الروضة',
      building_number: '4410',
    },
  },
};

/** The manager is on the file and may not sign. A different answer from "not found". */
const MANAGER_NOT_AUTHORISED: StubScenario = {
  kind: 'OK',
  data: {
    business_verification: {
      unified_number: '7000000011',
      cr_number: '3030303030',
      cr_status: 'ACTIVE',
      company_name: 'شركة الصلاحية المحدودة',
      capital: 250000,
      city: 'الدمام',
      district: 'الفيصلية',
      building_number: '7712',
    },
    articles_of_association: {
      unified_number: '7000000011',
      document_number: 'AOA-99001',
      managers: [
        {
          name: 'سعد الحربي',
          id: '1055500011',
          id_type: 'NATIONAL_ID',
          signing_authority: 'JOINT',
          verified: false,
        },
      ],
    },
    manager_permissions: {
      unified_number: '7000000011',
      manager_id: '1055500011',
      signing_authority: 'JOINT',
      verified: false,
      scope: 'LIMITED',
    },
  },
};

/** The company exists and has no national address on record. */
const NO_ADDRESS: StubScenario = {
  kind: 'OK',
  data: {
    business_verification: {
      unified_number: '7000000012',
      cr_number: '4040404040',
      cr_status: 'ACTIVE',
      company_name: 'شركة بلا عنوان وطني',
      capital: 50000,
      // No city, no district, no building number. The address step finds nothing.
    },
  },
};

/** A freelance certificate that has lapsed. */
const FREELANCE_EXPIRED: StubScenario = {
  kind: 'OK',
  data: {
    freelancer_certificate: {
      certificate_number: 'FL-2020-00001',
      freelancer_name: 'نورة القحطاني',
      certificate_status: 'EXPIRED',
      issue_date: '2020-01-01',
      expiry_date: '2022-01-01',
      activity: 'تصميم جرافيك',
    },
  },
};

/** The account exists and the name on it is somebody else. */
const ACCOUNT_NAME_MISMATCH: StubScenario = {
  kind: 'OK',
  data: {
    bank_account_ownership: {
      match_result: 'NO_MATCH',
      account_holder_name: 'مؤسسة أخرى للتجارة',
      account_status: 'ACTIVE',
      account_currency: 'SAR',
      match_score: 0.21,
      verification_method: 'CONFIRMATION_OF_PAYEE_SERVICE',
    },
    iban_ownership: {
      iban: 'SA9980000000608010167599',
      match_result: 'NO_MATCH',
      account_holder_name: 'مؤسسة أخرى للتجارة',
      holder_identifier: '1010999999',
      bank_name: 'Example Bank',
    },
  },
};

/** A deed with a mortgage on it. The answer a lender is actually asking for. */
const DEED_ENCUMBERED: StubScenario = {
  kind: 'OK',
  data: {
    property_deed: {
      deed_number: '999000111222',
      deed_status: 'ENCUMBERED',
      owner_name: 'شركة المثال للتجارة',
      owner_identifier: '1010478213',
      property_type: 'BUILDING',
      city: 'الرياض',
      district: 'الملقا',
      area_sqm: 800,
      issue_date: '2019-08-20',
      encumbrances: [{ type: 'MORTGAGE', holder: 'بنك المثال' }],
    },
  },
};

/** Identifier to scenario. Anything not listed here behaves as a full success. */
export const STUB_SCENARIOS: ReadonlyMap<string, StubScenario> = new Map([
  ['7001272184', FULL_SUCCESS],
  ['1010478213', FULL_SUCCESS],
  ['SA0380000000608010167519', FULL_SUCCESS],
  ['7000000000', NOT_FOUND],
  ['7000000001', NETWORK_ERROR],
  ['7000000002', AUTH_ERROR],
  ['7000000003', INCOMPLETE],
  // The published test data. Every one of these is a case a customer will meet in
  // production and would otherwise meet for the first time in production.
  ['7000000010', EXPIRED_CR],
  ['2020202020', EXPIRED_CR],
  ['7000000011', MANAGER_NOT_AUTHORISED],
  ['3030303030', MANAGER_NOT_AUTHORISED],
  ['7000000012', NO_ADDRESS],
  ['4040404040', NO_ADDRESS],
  ['FL202000001', FREELANCE_EXPIRED],
  ['SA9980000000608010167599', ACCOUNT_NAME_MISMATCH],
  ['999000111222', DEED_ENCUMBERED],
]);

export const DEFAULT_SCENARIO = FULL_SUCCESS;

/**
 * The scenarios by name, for a caller that would rather ask for one than remember which
 * identifier produces it.
 *
 * A customer's QA team writes a case called "expired registration" and wants to run it;
 * making them look up which number means that is friction with no purpose. Honoured only
 * for a sandbox key, because a live key that could choose its own answer would make every
 * result meaningless.
 */
export const SCENARIO_BY_NAME: ReadonlyMap<string, StubScenario> = new Map([
  ['success', FULL_SUCCESS],
  ['not_found', NOT_FOUND],
  ['network_error', NETWORK_ERROR],
  ['auth_error', AUTH_ERROR],
  ['incomplete', INCOMPLETE],
  ['expired_cr', EXPIRED_CR],
  ['manager_not_authorised', MANAGER_NOT_AUTHORISED],
  ['no_address', NO_ADDRESS],
  ['freelance_expired', FREELANCE_EXPIRED],
  ['account_mismatch', ACCOUNT_NAME_MISMATCH],
  ['deed_encumbered', DEED_ENCUMBERED],
]);

export const SCENARIO_NAMES: readonly string[] = [...SCENARIO_BY_NAME.keys()];

/**
 * Pulls the identifier out of a request. The stub accepts whichever key the binding used,
 * because product definitions choose their own request field names.
 */
export function scenarioKeyFor(input: Readonly<Record<string, unknown>>): string | null {
  const candidates = [
    'identifications',
    'unified_number',
    'unn',
    'cr_number',
    'iban',
    'certificate_number',
    'deed_number',
    'entity_id',
    'identifier',
    'id',
  ];
  for (const key of candidates) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) {
      return value.replace(/[\s-]/g, '').toUpperCase();
    }
  }
  return null;
}
