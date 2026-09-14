import type { LeanEndpointMapping } from './lean-provider.js';
import type { ProviderErrorCode } from '../types.js';

/**
 * The data source's verification products, as endpoint mappings.
 *
 * Built from its published specification for Saudi Arabia (docs branch v2.0-KSA), and
 * checked against the example responses recorded in ./sandbox. Seven calls:
 *
 *   corporate_full          POST /verifications/v1/corporates           type FULL
 *   corporate_contract      POST /verifications/v1/corporates           type CONTRACT
 *   corporate_address       POST /verifications/v1/corporates           type ADDRESS
 *   corporate_manager       POST /verifications/v1/corporates/managers  one manager
 *   freelancer_verification POST /verifications/v1/freelancers          type FULL
 *   iban_verification       POST /verifications/v2/iban                 ownership
 *   iban_beneficiary_name   POST /verifications/v2/beneficiary-name     holder name
 *   property_verification   POST /verifications/v1/properties           not enabled yet
 *
 * Four things about that API shape everything below, and each is handled here so nothing
 * outside this file has to know it:
 *
 * 1. Every text field comes as {ar, en} and a call fills only the language it asked for.
 *    We ask for Arabic, and read English only when Arabic is empty.
 * 2. A company is looked up by its unified number alone. The registration number comes
 *    back in one of two fields whose names the specification and the guides swap, so it is
 *    read as whichever of the two is not the unified number we sent.
 * 3. People inside a response (managers, partners) carry an identity whose type text is
 *    unreliable: the specification's own example labels an endowment deed as type 1. The
 *    identity is therefore classified by its number: ten digits starting with 1 is a
 *    national ID, starting with 2 is a residence ID. Anything else cannot be matched to a
 *    person safely and is counted rather than guessed at (rule 4 forbids storing it, and a
 *    guessed type would merge two different people).
 * 4. A business failure is HTTP 200 with status FAILED and a granular code. DATA_NOT_FOUND
 *    is an answer, not found. Everything else is a failure of the source, not billed.
 *
 * The flat bag each map returns uses our names, and product rows in step_field_map point
 * at those names (rule 8). Identifiers go into the bag only where a mapping resolves them
 * into an entity; the bag itself is never stored.
 */

type Bag = Record<string, unknown>;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Arabic first, English when Arabic is empty, null when neither. */
export function text(value: unknown): string | null {
  const record = asRecord(value);
  const ar = record['ar'];
  const en = record['en'];
  if (typeof ar === 'string' && ar.trim() !== '') {
    return ar.trim();
  }
  if (typeof en === 'string' && en.trim() !== '') {
    return en.trim();
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return null;
}

/**
 * Drops what the answer did not say.
 *
 * A field the registry left empty is not a fact, and recording it as one would fill a file
 * with rows reading "suspension date: none" and turn every later value into a change. An
 * empty list is dropped for the same reason. False and zero are answers and stay.
 */
export function compact(bag: Bag): Bag {
  return Object.fromEntries(
    Object.entries(bag).filter(
      ([, value]) =>
        value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0),
    ),
  );
}

function gregorian(value: unknown): string | null {
  return stringOrNull(asRecord(value)['gregorian']);
}

/**
 * Which of our identifier types a person's number is, by its shape.
 *
 * Saudi national IDs start with 1 and residence IDs with 2, both ten digits. Nothing else
 * in a registry response can be matched to a person without guessing.
 */
export function personIdentifierType(id: unknown): 'NATIONAL_ID' | 'IQAMA' | null {
  if (typeof id !== 'string' || !/^[12][0-9]{9}$/.test(id)) {
    return null;
  }
  return id.startsWith('1') ? 'NATIONAL_ID' : 'IQAMA';
}

/** A company or a sole establishment, from the registry's own entity type. */
export function companyKind(entityType: unknown): 'COMPANY' | 'ESTABLISHMENT' | null {
  const name = `${text(asRecord(entityType)['name']) ?? ''} ${stringOrNull(asRecord(asRecord(entityType)['name'])['en']) ?? ''}`;
  if (/مؤسسة|establishment/i.test(name)) {
    return 'ESTABLISHMENT';
  }
  if (/شركة|company/i.test(name)) {
    return 'COMPANY';
  }
  return null;
}

/** The outcome of a verification call, read from the envelope. */
export function verificationOutcome(
  payload: Readonly<Record<string, unknown>>,
): 'OK' | 'NOT_FOUND' | 'ERROR' {
  const status = String(payload['status'] ?? '');
  if (status === 'OK') {
    return 'OK';
  }
  const code = stringOrNull(asRecord(payload['status_detail'])['granular_status_code']);
  return code === 'DATA_NOT_FOUND' ? 'NOT_FOUND' : 'ERROR';
}

export function verificationFailureCode(
  payload: Readonly<Record<string, unknown>>,
): ProviderErrorCode {
  const code = stringOrNull(asRecord(payload['status_detail'])['granular_status_code']);
  switch (code) {
    case 'BANK_ISSUE':
    case 'LEAN_ERROR':
      return 'UPSTREAM';
    case 'UNSUPPORTED_BY_BANK':
    case 'DISABLED_BY_LEAN':
    case 'DISABLED_BY_CLIENT':
      return 'SOURCE_UNAVAILABLE';
    case 'GIVEN_INPUT_CANNOT_BE_VERIFIED':
      return 'INVALID_INPUT';
    default:
      return 'UPSTREAM';
  }
}

interface MappedPerson {
  name: string | null;
  identity_id: string;
  identity_type: 'NATIONAL_ID' | 'IQAMA';
  nationality: string | null;
  positions: string[];
}

function positionsOf(value: unknown): string[] {
  return asArray(value)
    .map((position) => text(position))
    .filter((position): position is string => position !== null);
}

function nationalityOf(value: unknown): string | null {
  const record = asRecord(value);
  return text(record['type']) ?? text(record);
}

function mapManagers(value: unknown): {
  people: (MappedPerson & { manager_type: string | null; is_licensed: boolean | null })[];
  total: number;
} {
  const all = asArray(value).map(asRecord);
  const people = all.flatMap((manager) => {
    const identity = asRecord(manager['identity']);
    const id = stringOrNull(identity['id']);
    const type = personIdentifierType(id);
    if (!id || !type) {
      return [];
    }
    return [
      {
        name: text(manager['name']),
        identity_id: id,
        identity_type: type,
        nationality: nationalityOf(manager['nationality']),
        positions: positionsOf(manager['positions']),
        manager_type: text(manager['type']),
        is_licensed: booleanOrNull(manager['is_licensed']),
      },
    ];
  });
  return { people, total: all.length };
}

function mapParties(value: unknown): { people: Bag[]; businesses: Bag[]; total: number } {
  const all = asArray(value).map(asRecord);
  const people: Bag[] = [];
  const businesses: Bag[] = [];

  for (const party of all) {
    const identity = asRecord(party['identity']);
    const id = stringOrNull(identity['id']);
    const share = asRecord(party['partner_share']);
    const distribution = asRecord(party['partner_profit_loss_distribution']);
    const common = {
      name: text(party['name']),
      party_type: text(party['type']),
      roles: positionsOf(party['partnership']),
      share_count: numberOrNull(share['total_contribution_count']),
      profit_pct: numberOrNull(distribution['profit_distribution']),
      loss_pct: numberOrNull(distribution['loss_distribution']),
      nationality: nationalityOf(party['nationality']),
    };

    const personType = personIdentifierType(id);
    if (id && personType) {
      people.push({ ...common, identity_id: id, identity_type: personType });
      continue;
    }
    const cr = stringOrNull(party['commercial_registration_number']);
    if (cr && /^[0-9]{10}$/.test(cr)) {
      businesses.push({ ...common, cr_number: cr });
    }
  }

  return { people, businesses, total: all.length };
}

function registryNumber(
  verifications: Record<string, unknown>,
  unifiedNumber: string | null,
): string | null {
  const registry = asRecord(verifications['commercial_registry']);
  const candidates = [
    stringOrNull(registry['national_number']),
    stringOrNull(registry['registration_number']),
  ];
  return candidates.find((value) => value !== null && value !== unifiedNumber) ?? null;
}

function corporateBody(type: 'FULL' | 'BASIC' | 'CONTRACT' | 'ADDRESS') {
  return (input: Readonly<Record<string, unknown>>) => ({
    type,
    language: 'ar',
    identifications: [{ type: 'UNIFIED_NUMBER', value: String(input['unn'] ?? '') }],
  });
}

export function mapCorporateFull(
  payload: Readonly<Record<string, unknown>>,
  input: Readonly<Record<string, unknown>> = {},
): Bag {
  const v = asRecord(payload['verifications']);
  const unn = stringOrNull(input['unn']);
  const managers = mapManagers(asRecord(v['management'])['managers']);
  const parties = mapParties(v['parties']);
  const fiscal = asRecord(v['fiscal_year']);
  const fiscalEnd =
    numberOrNull(fiscal['end_month']) !== null && numberOrNull(fiscal['end_day']) !== null
      ? `${String(fiscal['end_month']).padStart(2, '0')}-${String(fiscal['end_day']).padStart(2, '0')}`
      : null;

  return compact({
    company_name: text(v['company_name']),
    cr_number: registryNumber(v, unn),
    status_text: text(v['status']),
    status_code: numberOrNull(asRecord(v['status'])['id']),
    entity_type: text(asRecord(v['entity_type'])['name']),
    legal_form: text(asRecord(v['entity_type'])['form_name']),
    company_kind: companyKind(v['entity_type']),
    issue_date: gregorian(v['issue_date']),
    confirmation_date: gregorian(v['confirmation_date']),
    suspension_date: gregorian(v['suspension_date']),
    deletion_date: gregorian(v['deletion_date']),
    reactivation_date: gregorian(v['reactivation_date']),
    capital: numberOrNull(v['commercial_registration_capital']),
    headquarters_city: text(asRecord(v['headquarters'])['city_name']),
    activities: asArray(v['activities'])
      .map((activity) => text(activity))
      .filter((activity): activity is string => activity !== null),
    in_liquidation: booleanOrNull(v['in_liquidation_process']),
    has_ecommerce: booleanOrNull(v['has_e_commerce']),
    is_main_registry: booleanOrNull(asRecord(v['main_commercial_registry'])['is_main']),
    license_based: booleanOrNull(asRecord(v['license'])['is_license_based']),
    license_issuer: text(asRecord(v['license'])['issuer_name']),
    website: stringOrNull(asRecord(v['contact_info'])['website_url']),
    fiscal_year_end: fiscalEnd,
    partners_nationality: text(asRecord(v['partners'])['nationality']),
    management_structure: text(asRecord(v['management'])['structure_name']),
    managers: managers.people,
    managers_total: managers.total,
    managers_unmatched: managers.total - managers.people.length,
    partners: parties.people,
    partner_businesses: parties.businesses,
    partners_total: parties.total,
  });
}

export function mapCorporateContract(
  payload: Readonly<Record<string, unknown>>,
  input: Readonly<Record<string, unknown>> = {},
): Bag {
  const v = asRecord(payload['verifications']);
  const management = asRecord(v['management']);
  const managers = mapManagers(management['managers']);
  const parties = mapParties(v['parties']);
  const capital = asRecord(v['capital_information']);
  const contribution = asRecord(capital['contribution_capital']);
  const stock = asRecord(capital['stock_capital']);
  const setAside = asRecord(asRecord(v['set_aside_details'])['profit_allocation']);

  return compact({
    company_name: text(v['company_name']),
    cr_number: registryNumber(v, stringOrNull(input['unn'])),
    contract_date: stringOrNull(v['contract_date']),
    contract_copy_number: numberOrNull(v['contract_copy_number']),
    management_structure: text(management['structure_name']),
    dismissal_method: text(management['dismissal_method']),
    capital: numberOrNull(v['commercial_registration_capital']),
    capital_type:
      text(contribution['type']) ?? text(contribution) ?? text(stock['type']) ?? text(stock),
    cash_capital: numberOrNull(contribution['cash_capital']) ?? numberOrNull(stock['cash_capital']),
    in_kind_capital:
      numberOrNull(contribution['in_kind_capital']) ?? numberOrNull(stock['in_kind_capital']),
    profit_set_aside_pct: numberOrNull(setAside['percentage']),
    directors_board_members: numberOrNull(asRecord(management['directors_board'])['member_count']),
    partner_decisions: asArray(v['partner_decision'])
      .map(asRecord)
      .map((decision) => ({
        name: text(decision['name']),
        approve_percentage: numberOrNull(decision['approve_percentage']),
      }))
      .filter((decision) => decision.name !== null),
    articles_count: asArray(v['articles']).length + asArray(v['additional_articles']).length,
    managers: managers.people,
    managers_total: managers.total,
    managers_unmatched: managers.total - managers.people.length,
    partners: parties.people,
    partner_businesses: parties.businesses,
    partners_total: parties.total,
  });
}

export function mapCorporateAddress(payload: Readonly<Record<string, unknown>>): Bag {
  const v = asRecord(payload['verifications']);
  const addresses = asArray(v['addresses']).map(asRecord);
  const primary =
    addresses.find((address) => booleanOrNull(address['is_primary_address']) === true) ??
    addresses[0] ??
    {};

  const building = stringOrNull(primary['building_number']);
  const postcode = stringOrNull(primary['post_code']);
  const additional = stringOrNull(primary['additional_number']);

  return compact({
    building_number: building,
    street: stringOrNull(primary['street']),
    district: stringOrNull(primary['district']),
    city: stringOrNull(primary['city']),
    postal_code: postcode,
    additional_number: additional,
    region: stringOrNull(primary['region_name']),
    unit_number: stringOrNull(primary['unit_number']),
    latitude: numberOrNull(primary['latitude']),
    longitude: numberOrNull(primary['longitude']),
    address_status: stringOrNull(primary['status']),
    addresses_count: addresses.length,
    // What makes two establishments share an address: the same building, postcode and
    // additional number. Not an identifier of anybody, so it may be stored as a fact.
    address_key:
      building && postcode && additional ? `${building}-${postcode}-${additional}` : null,
  });
}

export function mapCorporateManager(
  payload: Readonly<Record<string, unknown>>,
  input: Readonly<Record<string, unknown>> = {},
): Bag {
  const manager = asRecord(asArray(payload['verifications'])[0]);
  const identity = asRecord(manager['identity']);
  // The identity asked about, when the answer does not repeat it.
  const id = stringOrNull(identity['id']) ?? stringOrNull(input['manager_id']);
  const type = personIdentifierType(id);
  const permissions = asArray(manager['permissions'])
    .map(asRecord)
    .map((permission) => ({
      name: text(permission['name']),
      method: text(permission['exercise_method_description']),
      can_issue_poa: booleanOrNull(permission['can_issue_poa']),
      can_delegate: booleanOrNull(permission['can_delegate']),
      condition: text(permission['special_condition_text']),
    }))
    .filter((permission) => permission.name !== null);

  const people =
    id && type
      ? [
          {
            name: text(manager['name']),
            identity_id: id,
            identity_type: type,
            nationality: nationalityOf(manager['nationality']),
            positions: positionsOf(manager['positions']),
            permissions,
            // Whether the registry lists this person as a manager of this company at all.
            listed: Object.keys(manager).length > 0,
          },
        ]
      : [];

  return compact({ managers: people, permissions_count: permissions.length });
}

export function mapFreelancer(
  payload: Readonly<Record<string, unknown>>,
  input: Readonly<Record<string, unknown>> = {},
): Bag {
  const v = asRecord(payload['verifications']);
  const certificates = asArray(v['certificate']).map(asRecord);
  const asked = stringOrNull(input['certificate_number']);
  const certificate =
    certificates.find((entry) => asked !== null && stringOrNull(entry['number']) === asked) ??
    certificates[0] ??
    {};
  const speciality = asRecord(certificate['speciality']);

  return compact({
    ownership: stringOrNull(v['certificate_ownership_verified']),
    name: text(v['name']),
    gender: stringOrNull(v['gender']),
    national_id_expiry: stringOrNull(v['national_id_expiry_date']),
    certificate_status: stringOrNull(certificate['status']),
    certificate_issue_date: stringOrNull(certificate['issue_date']),
    certificate_expiry_date: stringOrNull(certificate['expiry_date']),
    speciality: text(speciality['name']),
    category: text(asRecord(speciality['category'])['name']),
    certificates_count: certificates.length,
  });
}

export function mapIbanVerification(
  payload: Readonly<Record<string, unknown>>,
  input: Readonly<Record<string, unknown>> = {},
): Bag {
  const v = asRecord(payload['verifications']);
  const verified = booleanOrNull(v['iban_ownership_verified']);
  const matching = asRecord(v['matching']);
  const matchType = stringOrNull(matching['type']);

  return compact({
    ownership: verified === true ? 'MATCH' : matchType === 'PARTIAL' ? 'PARTIAL' : 'NO_MATCH',
    match_score: numberOrNull(matching['score']),
    bank_name: text(v['bank_name']),
    swift_code: stringOrNull(v['swift_code']),
    account_status: stringOrNull(v['account_status']),
    holder_name: stringOrNull(v['account_holder_name']),
    verification_method: stringOrNull(v['verification_method']),
    // Echoed so the account resolves to one entity per IBAN and a shared account shows
    // up as a link between customers. Held in this bag only, never stored as a value.
    iban: stringOrNull(input['iban']),
    // The same answers again under the names the account entity's mappings read, because a
    // mapping is keyed on its source and one source cannot feed two entities.
    account_bank: text(v['bank_name']),
    account_ownership:
      verified === true ? 'MATCH' : matchType === 'PARTIAL' ? 'PARTIAL' : 'NO_MATCH',
  });
}

export function mapBeneficiaryName(
  payload: Readonly<Record<string, unknown>>,
  input: Readonly<Record<string, unknown>> = {},
): Bag {
  const v = asRecord(payload['verifications']);
  return compact({
    beneficiary_name: stringOrNull(v['beneficiary_name']),
    account_status: stringOrNull(v['account_status']),
    iban: stringOrNull(input['iban']),
  });
}

/** Who confirmed an account, by the route the answer came through. */
export function ibanAuthority(payload: Readonly<Record<string, unknown>>): string {
  const method = stringOrNull(asRecord(payload['verifications'])['verification_method']);
  switch (method) {
    case 'OPEN_BANKING':
      return 'البنك عبر المصرفية المفتوحة';
    case 'CONFIRMATION_OF_PAYEE_SERVICE':
      return 'خدمة التحقق من المستفيد';
    default:
      return 'المدفوعات السعودية';
  }
}

function ibanIdentifications(
  input: Readonly<Record<string, unknown>>,
): { type: string; value: string }[] {
  const identifications: { type: string; value: string }[] = [];
  const push = (type: string, key: string): void => {
    const value = stringOrNull(input[key]);
    if (value) {
      identifications.push({ type, value });
    }
  };
  push('UNIFIED_NUMBER', 'unn');
  push('COMMERCIAL_REGISTRATION', 'cr_number');
  push('NATIONAL_ID', 'national_id');
  push('FREELANCER_NUMBER', 'certificate_number');
  return identifications;
}

export const LEAN_VERIFICATION_ENDPOINTS: Readonly<Record<string, LeanEndpointMapping>> = {
  corporate_full: {
    path: '/verifications/v1/corporates',
    authority: 'وزارة التجارة',
    body: corporateBody('FULL'),
    map: mapCorporateFull,
    outcome: verificationOutcome,
    failureCode: verificationFailureCode,
  },
  corporate_contract: {
    path: '/verifications/v1/corporates',
    authority: 'وزارة التجارة',
    body: corporateBody('CONTRACT'),
    map: mapCorporateContract,
    outcome: verificationOutcome,
    failureCode: verificationFailureCode,
  },
  corporate_address: {
    path: '/verifications/v1/corporates',
    authority: 'العنوان الوطني',
    body: corporateBody('ADDRESS'),
    map: mapCorporateAddress,
    outcome: verificationOutcome,
    failureCode: verificationFailureCode,
  },
  corporate_manager: {
    path: '/verifications/v1/corporates/managers',
    authority: 'وزارة التجارة',
    body: (input) => ({
      language: 'ar',
      identifications: [
        { type: 'UNIFIED_NUMBER', value: String(input['unn'] ?? '') },
        {
          type:
            personIdentifierType(input['manager_id']) === 'IQAMA' ? 'RESIDENT_ID' : 'NATIONAL_ID',
          value: String(input['manager_id'] ?? ''),
        },
      ],
    }),
    map: mapCorporateManager,
    outcome: verificationOutcome,
    failureCode: verificationFailureCode,
  },
  freelancer_verification: {
    path: '/verifications/v1/freelancers',
    authority: 'وزارة الموارد البشرية والتنمية الاجتماعية',
    body: (input) => ({
      type: 'FULL',
      identifications: [
        { type: 'NATIONAL_ID', value: String(input['national_id'] ?? '') },
        { type: 'FREELANCER_NUMBER', value: String(input['certificate_number'] ?? '') },
      ],
    }),
    map: mapFreelancer,
    outcome: verificationOutcome,
    failureCode: verificationFailureCode,
  },
  iban_verification: {
    path: '/verifications/v2/iban',
    authority: 'المدفوعات السعودية',
    authorityFor: ibanAuthority,
    body: (input) => ({
      type: String(input['account_type'] ?? 'BUSINESS'),
      iban: String(input['iban'] ?? ''),
      identifications: ibanIdentifications(input),
    }),
    map: mapIbanVerification,
    outcome: verificationOutcome,
    failureCode: verificationFailureCode,
  },
  iban_beneficiary_name: {
    path: '/verifications/v2/beneficiary-name',
    authority: 'المدفوعات السعودية',
    body: (input) => ({ iban: String(input['iban'] ?? '') }),
    map: mapBeneficiaryName,
    outcome: verificationOutcome,
    failureCode: verificationFailureCode,
  },
  property_verification: {
    path: '/verifications/v1/properties',
    authority: 'السجل العقاري',
    body: (input) => ({
      verification_type: 'BASIC',
      identifications: [
        { type: 'PROPERTY_NUMBER', value: String(input['property_number'] ?? '') },
        ...(input['owner_id'] ? [{ type: 'NATIONAL_ID', value: String(input['owner_id']) }] : []),
      ],
    }),
    map: (payload) => {
      const v = asRecord(payload['verifications']);
      return { property_status: stringOrNull(v['status']) };
    },
    outcome: verificationOutcome,
    failureCode: verificationFailureCode,
  },
};

export interface InterpretedAnswer {
  outcome: 'OK' | 'NOT_FOUND' | 'ERROR';
  authority: string | null;
  data: Record<string, unknown> | null;
  errorCode?: ProviderErrorCode;
  retryable?: boolean;
}

/**
 * What an answer means, read the same way whoever produced it.
 *
 * The live adapter and the sandbox both call this, so a sandbox answer and a production
 * answer with the same content become the same attestations.
 */
export function interpretAnswer(
  mapping: LeanEndpointMapping,
  payload: Record<string, unknown>,
  input: Readonly<Record<string, unknown>>,
): InterpretedAnswer {
  const outcome = mapping.outcome?.(payload) ?? 'OK';
  if (outcome === 'ERROR') {
    const errorCode = mapping.failureCode?.(payload) ?? 'UPSTREAM';
    return { outcome, authority: null, data: null, errorCode, retryable: errorCode === 'UPSTREAM' };
  }
  const authority = mapping.authorityFor?.(payload) ?? mapping.authority;
  if (outcome !== 'OK') {
    return { outcome: 'NOT_FOUND', authority, data: null };
  }
  return { outcome: 'OK', authority, data: mapping.map(payload, input) };
}
