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

/** Identifier to scenario. Anything not listed here behaves as a full success. */
export const STUB_SCENARIOS: ReadonlyMap<string, StubScenario> = new Map([
  ['7001272184', FULL_SUCCESS],
  ['1010478213', FULL_SUCCESS],
  ['SA0380000000608010167519', FULL_SUCCESS],
  ['7000000000', NOT_FOUND],
  ['7000000001', NETWORK_ERROR],
  ['7000000002', AUTH_ERROR],
  ['7000000003', INCOMPLETE],
]);

export const DEFAULT_SCENARIO = FULL_SUCCESS;

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
