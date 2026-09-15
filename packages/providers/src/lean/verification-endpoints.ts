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
 * 3. People inside a response (managers, partners, liquidators, guardians) carry an identity
 *    whose type code is unreliable: the specification's own example labels an endowment deed
 *    as type 1. The identity is therefore classified by its number first: ten digits starting
 *    with 1 is a national ID, starting with 2 is a residence ID, unless the authority's own
 *    words for the document name a registry. A registration number is a business. Anything
 *    else, a passport, a Gulf ID, an endowment deed, is kept as an identity of its own kind
 *    (PARTY_ID) beside the authority's name for it, so it never merges with a national ID
 *    or a registration that happens to share its digits.
 * 4. A business failure is HTTP 200 with status FAILED and a granular code. DATA_NOT_FOUND
 *    is an answer, not found. Everything else is a failure of the source, not billed.
 *
 * The flat bag each map returns uses our names, and product rows in step_field_map point
 * at those names (rule 8). Everything an answer says is read, the owner's ask: a registry
 * answer's dates in both calendars, its capital, contact details, e-stores, fiscal year,
 * boards and liquidators, the articles' full text, every address. What is left out is only
 * the source's own internal codes (a city's number beside its name, a type's number beside
 * its words) and the request's own envelope. Identifiers go into the bag only where a
 * mapping resolves them into an entity; the bag itself is never stored.
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

/** The records of a list that say something, each without the keys it left empty. */
function records(list: readonly Bag[]): Bag[] {
  return list.map(compact).filter((entry) => Object.keys(entry).length > 0);
}

function gregorian(value: unknown): string | null {
  return stringOrNull(asRecord(value)['gregorian']);
}

/** The same registry date in the Hijri calendar, kept beside the Gregorian one. */
function hijri(value: unknown): string | null {
  return stringOrNull(asRecord(value)['hijri']);
}

/**
 * The English beside an Arabic text, when an answer gives both and they differ.
 *
 * A registry call asks for Arabic and fills one language, so this is usually absent there;
 * the freelance and bank answers carry both.
 */
export function english(value: unknown): string | null {
  const record = asRecord(value);
  const ar = stringOrNull(record['ar']);
  const en = stringOrNull(record['en']);
  return ar !== null && en !== null && en !== ar ? en : null;
}

/** Every text in a list of {ar, en}, in order. */
function texts(value: unknown): string[] {
  return asArray(value)
    .map((entry) => text(entry))
    .filter((entry): entry is string => entry !== null);
}

/** Every name in a list of {id, name: {ar, en}}, such as a board's positions. */
function names(value: unknown): string[] {
  return asArray(value)
    .map((entry) => text(asRecord(entry)['name']))
    .filter((entry): entry is string => entry !== null);
}

/**
 * When a business was established, from how many days old the registry said it was on the day
 * it answered.
 *
 * The age itself grows by one every day, so recording it would register a change on every
 * verification. The day it counts from does not.
 */
export function establishedOn(days: unknown, answeredAt: unknown): string | null {
  const count = numberOrNull(days);
  if (count === null || count < 0) {
    return null;
  }
  const at = typeof answeredAt === 'string' ? new Date(answeredAt) : new Date(Number.NaN);
  const from = Number.isNaN(at.getTime()) ? new Date() : at;
  return new Date(from.getTime() - count * 86_400_000).toISOString().slice(0, 10);
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

function positionsOf(value: unknown): string[] {
  return texts(value);
}

function nationalityOf(value: unknown): string | null {
  const record = asRecord(value);
  return text(record['type']) ?? text(record);
}

/** The authority's words for a registry document: a commercial registration, a unified number. */
const REGISTRY_DOCUMENT = /سجل تجاري|السجل التجاري|منشأة|الموحد|commercial regist|unified/i;
/** Its words for a document a person carries: an ID, a residence permit, a passport. */
const PERSONAL_DOCUMENT =
  /هوية|إقامة|اقامة|مقيم|جواز|مدني|خليجي|passport|resident|iqama|national id|gcc/i;

export interface PartyIdentity {
  identity_id: string;
  identity_type: 'NATIONAL_ID' | 'IQAMA' | 'CR' | 'UNN' | 'PARTY_ID';
  /** The authority's own name for the document, kept where our type does not already say it. */
  identity_label: string | null;
  kind: 'PERSON' | 'BUSINESS';
}

/**
 * Who a party in an answer is, as something an entity can be resolved by.
 *
 * A national ID or residence ID by its shape (unless the document is named as a registry), a
 * registration number as a business, and anything else as an identity of its own kind with
 * the authority's name for it: an endowment deed is an organisation, a passport a person.
 * Null only when the answer gave no number at all, and then the party is counted.
 */
export function partyIdentity(
  identity: unknown,
  registration: unknown = null,
): PartyIdentity | null {
  const record = asRecord(identity);
  const id = stringOrNull(record['id']);
  const label = text(record['type']);
  const namesRegistry = label !== null && REGISTRY_DOCUMENT.test(label);
  const personType = personIdentifierType(id);
  if (id !== null && personType !== null && !namesRegistry) {
    return { identity_id: id, identity_type: personType, identity_label: null, kind: 'PERSON' };
  }
  const number = stringOrNull(registration) ?? (namesRegistry ? id : null);
  if (number !== null && /^[0-9]{10}$/.test(number)) {
    return {
      identity_id: number,
      identity_type: number.startsWith('7') ? 'UNN' : 'CR',
      identity_label: null,
      kind: 'BUSINESS',
    };
  }
  if (id !== null) {
    return {
      identity_id: id,
      identity_type: 'PARTY_ID',
      identity_label: label,
      kind: label !== null && PERSONAL_DOCUMENT.test(label) ? 'PERSON' : 'BUSINESS',
    };
  }
  return null;
}

/** The identity keys of a mapped person, for a party that must resolve to a person. */
function asPerson(identity: PartyIdentity): Bag {
  // A person named with a registry number is still a person here: kept under its own kind so
  // it never merges with the business that number belongs to.
  const business = identity.identity_type === 'CR' || identity.identity_type === 'UNN';
  return {
    identity_id: identity.identity_id,
    identity_type: business ? 'PARTY_ID' : identity.identity_type,
    identity_label: identity.identity_label,
  };
}

function mapManagers(value: unknown): { people: Bag[]; total: number } {
  const all = asArray(value).map(asRecord);
  const people = all.flatMap((manager) => {
    const identity = partyIdentity(manager['identity']);
    if (identity === null) {
      return [];
    }
    return [
      {
        name: text(manager['name']),
        name_en: english(manager['name']),
        ...asPerson(identity),
        nationality: nationalityOf(manager['nationality']),
        positions: positionsOf(manager['positions']),
        manager_type: text(manager['type']),
        is_licensed: booleanOrNull(manager['is_licensed']),
      },
    ];
  });
  return { people: records(people), total: all.length };
}

/**
 * The partners of an answer: people, businesses and the guardians who act for a minor.
 *
 * Each keeps everything the registry said of it in this company: its kind of party, its role,
 * its shares (cash, in kind and in total), its share of profits and of losses, its licence
 * number and its nationality.
 */
function mapParties(value: unknown): {
  people: Bag[];
  businesses: Bag[];
  guardians: Bag[];
  total: number;
} {
  const all = asArray(value).map(asRecord);
  const people: Bag[] = [];
  const businesses: Bag[] = [];
  const guardians: Bag[] = [];

  for (const party of all) {
    const share = asRecord(party['partner_share']);
    const distribution = asRecord(party['partner_profit_loss_distribution']);
    const guardian = asRecord(party['guardian']);
    const guardianName = text(guardian['name']);
    const common = {
      name: text(party['name']),
      name_en: english(party['name']),
      party_type: text(party['type']),
      roles: positionsOf(party['partnership']),
      share_count: numberOrNull(share['total_contribution_count']),
      cash_shares: numberOrNull(share['cash_contribution_count']),
      in_kind_shares: numberOrNull(share['in_kind_contribution_count']),
      profit_pct: numberOrNull(distribution['profit_distribution']),
      loss_pct: numberOrNull(distribution['loss_distribution']),
      license_number: stringOrNull(party['license_number']),
      nationality: nationalityOf(party['nationality']),
      guardian: guardianName,
    };

    const identity = partyIdentity(party['identity'], party['commercial_registration_number']);
    if (identity === null) {
      continue;
    }
    if (identity.kind === 'PERSON') {
      people.push({ ...common, ...asPerson(identity) });
    } else {
      businesses.push({
        ...common,
        identity_id: identity.identity_id,
        identity_type: identity.identity_type,
        identity_label: identity.identity_label,
      });
    }

    const guardianIdentity = partyIdentity(guardian['identity']);
    if (guardianName !== null && guardianIdentity !== null) {
      guardians.push({
        name: guardianName,
        ...asPerson(guardianIdentity),
        nationality: nationalityOf(guardian['nationality']),
        is_father: booleanOrNull(guardian['is_father_guardian']),
        ward: common.name,
      });
    }
  }

  return {
    people: records(people),
    businesses: records(businesses),
    guardians: records(guardians),
    total: all.length,
  };
}

/** Whoever the registry names as liquidating a company, people and firms apart. */
function mapLiquidators(value: unknown): { people: Bag[]; businesses: Bag[]; total: number } {
  const all = asArray(value).map(asRecord);
  const people: Bag[] = [];
  const businesses: Bag[] = [];
  for (const liquidator of all) {
    const identity = partyIdentity(liquidator['identity']);
    if (identity === null) {
      continue;
    }
    const common = {
      name: text(liquidator['name']),
      liquidator_type: text(liquidator['type']),
      nationality: nationalityOf(liquidator['nationality']),
      positions: positionsOf(liquidator['positions']),
    };
    if (identity.kind === 'PERSON') {
      people.push({ ...common, ...asPerson(identity) });
    } else {
      businesses.push({
        ...common,
        identity_id: identity.identity_id,
        identity_type: identity.identity_type,
        identity_label: identity.identity_label,
      });
    }
  }
  return { people: records(people), businesses: records(businesses), total: all.length };
}

/**
 * A company's capital as the registry breaks it down: the currency, contributed capital (cash,
 * in kind, the value of a share and how many shares of each) and share capital (announced,
 * paid, and each class of stock).
 */
function capitalOf(value: unknown): Bag {
  const capital = asRecord(value);
  const contribution = asRecord(capital['contribution_capital']);
  const stock = asRecord(capital['stock_capital']);
  return {
    capital_currency: text(capital['currency']),
    capital_type: text(contribution['type']) ?? text(contribution),
    cash_capital: numberOrNull(contribution['cash_capital']),
    in_kind_capital: numberOrNull(contribution['in_kind_capital']),
    share_value: numberOrNull(contribution['contribution_value']),
    cash_shares: numberOrNull(contribution['total_cash_contribution']),
    in_kind_shares: numberOrNull(contribution['total_in_kind_contribution']),
    stock_type: text(stock['type']) ?? text(stock),
    stock_capital: numberOrNull(stock['capital']),
    announced_capital: numberOrNull(stock['announced_capital']),
    paid_capital: numberOrNull(stock['paid_capital']),
    stock_cash: numberOrNull(stock['cash_capital']),
    stock_in_kind: numberOrNull(stock['in_kind_capital']),
    stocks: records(
      asArray(stock['stocks'])
        .map(asRecord)
        .map((entry) => ({
          class_name: text(entry['class_name']),
          type: text(entry['type']) ?? text(entry),
          count: numberOrNull(entry['count']),
          value: numberOrNull(entry['value']),
        })),
    ),
  };
}

/**
 * The two boards a company may have, each flattened under its own prefix: the board of managers
 * (mb_) and the board of directors (db_).
 */
function boardsOf(management: Record<string, unknown>): Bag {
  const managers = asRecord(management['management_board']);
  const directors = asRecord(management['directors_board']);
  return {
    mb_quorum: text(managers['meeting_quorum_name']),
    mb_can_delegate: booleanOrNull(managers['can_delegate_attendance']),
    mb_term_years: numberOrNull(managers['term_years']),
    mb_way_of_work: text(managers['way_of_work']),
    mb_meeting_place: text(managers['meeting_place']),
    mb_additional_text: text(managers['additional_text']),
    mb_positions: names(managers['positions']),
    db_member_count: numberOrNull(directors['member_count']),
    db_term_years: numberOrNull(directors['term_years']),
    db_reward_value: numberOrNull(directors['value']),
    db_reward_max: numberOrNull(directors['value_max']),
    db_way_of_work: text(directors['way_of_work']),
    db_meeting_place: text(directors['meeting_place']),
    db_quorum: numberOrNull(directors['meeting_quorum']),
    db_legal_quorum: numberOrNull(directors['meeting_legal_quorum']),
    db_can_delegate: booleanOrNull(directors['can_delegate_attendance']),
    db_call_mechanism: text(directors['board_call_mechanism']),
    db_membership_expiry: text(directors['membership_expiry_terms']),
    db_additional_text: text(directors['additional_text']),
    db_rewards: names(directors['rewards']),
    db_positions: names(directors['positions']),
  };
}

/**
 * The main registration a branch belongs to, as a business to link to.
 *
 * Absent for a main registration itself, and for a number that is this business's own.
 */
function mainRegistryOf(
  verifications: Record<string, unknown>,
  own: readonly (string | null)[],
): Bag[] {
  const main = asRecord(verifications['main_commercial_registry']);
  if (booleanOrNull(main['is_main']) !== false) {
    return [];
  }
  const numbers = [stringOrNull(main['national_number']), stringOrNull(main['registration_number'])]
    .filter((value): value is string => value !== null && /^[0-9]{10}$/.test(value))
    .filter((value) => !own.includes(value));
  const number = numbers.find((value) => !value.startsWith('7')) ?? numbers[0];
  return number === undefined
    ? []
    : [
        {
          identity_id: number,
          identity_type: number.startsWith('7') ? 'UNN' : 'CR',
          has_branch: true,
        },
      ];
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

/** Codes aligned with a list of names, or nothing when the answer gave no code at all. */
function codesOf(value: unknown): string[] | null {
  const entries = asArray(value).filter((entry) => text(entry) !== null);
  const codes = entries.map((entry) => stringOrNull(asRecord(entry)['id']) ?? '');
  return codes.some((code) => code !== '') ? codes : null;
}

/** The parts of a registry answer both the full record and the articles carry. */
function peopleOf(verifications: Record<string, unknown>): Bag {
  const management = asRecord(verifications['management']);
  const managers = mapManagers(management['managers']);
  const parties = mapParties(verifications['parties']);
  return {
    managers: managers.people,
    managers_total: managers.total,
    managers_unmatched: managers.total - managers.people.length,
    partners: parties.people,
    partner_businesses: parties.businesses,
    guardians: parties.guardians,
    partners_total: parties.total,
  };
}

export function mapCorporateFull(
  payload: Readonly<Record<string, unknown>>,
  input: Readonly<Record<string, unknown>> = {},
): Bag {
  const v = asRecord(payload['verifications']);
  const unn = stringOrNull(input['unn']);
  const registry = asRecord(v['commercial_registry']);
  const crNumber = registryNumber(v, unn);
  const management = asRecord(v['management']);
  const fiscal = asRecord(v['fiscal_year']);
  const fiscalEnd =
    numberOrNull(fiscal['end_month']) !== null && numberOrNull(fiscal['end_day']) !== null
      ? `${String(fiscal['end_month']).padStart(2, '0')}-${String(fiscal['end_day']).padStart(2, '0')}`
      : null;
  const license = asRecord(v['license']);
  const contact = asRecord(v['contact_info']);
  const liquidators = mapLiquidators(v['liquidators']);

  return compact({
    // The registration.
    company_name: text(v['company_name']),
    company_name_en: english(v['company_name']),
    cr_number: crNumber,
    version_number: numberOrNull(registry['version_number']),
    name_language: text(asRecord(v['name_language'])['description']),
    status_text: text(v['status']),
    status_code: numberOrNull(asRecord(v['status'])['id']),
    entity_type: text(asRecord(v['entity_type'])['name']),
    legal_form: text(asRecord(v['entity_type'])['form_name']),
    entity_characters: texts(asRecord(v['entity_type'])['characters']),
    company_kind: companyKind(v['entity_type']),
    is_main_registry: booleanOrNull(asRecord(v['main_commercial_registry'])['is_main']),
    main_registry: mainRegistryOf(v, [crNumber, unn]),
    headquarters_city: text(asRecord(v['headquarters'])['city_name']),
    established_on: establishedOn(v['days_since_company_established'], payload['timestamp']),
    license_based: booleanOrNull(license['is_license_based']),
    license_issuer: text(license['issuer_name']),
    license_issuer_number: stringOrNull(license['issuer_national_number']),
    partners_nationality: text(asRecord(v['partners'])['nationality']),

    // Its dates, in both calendars.
    issue_date: gregorian(v['issue_date']),
    issue_date_hijri: hijri(v['issue_date']),
    confirmation_date: gregorian(v['confirmation_date']),
    confirmation_date_hijri: hijri(v['confirmation_date']),
    reactivation_date: gregorian(v['reactivation_date']),
    reactivation_date_hijri: hijri(v['reactivation_date']),
    suspension_date: gregorian(v['suspension_date']),
    suspension_date_hijri: hijri(v['suspension_date']),
    deletion_date: gregorian(v['deletion_date']),
    deletion_date_hijri: hijri(v['deletion_date']),

    // Its capital.
    capital: numberOrNull(v['commercial_registration_capital']),
    ...capitalOf(v['capital_information']),

    // What it does and where it sells.
    activities: texts(v['activities']),
    activity_codes: codesOf(v['activities']),
    has_ecommerce: booleanOrNull(v['has_e_commerce']),
    e_stores: records(
      asArray(asRecord(v['e_commerce'])['e_store'])
        .map(asRecord)
        .map((store) => ({
          store_url: stringOrNull(store['store_url']),
          platform_url: stringOrNull(store['authentication_platform_url']),
          activities: asArray(store['store_activities'])
            .map((activity) => {
              const name = text(activity);
              const code = stringOrNull(asRecord(activity)['id']);
              return name === null ? null : code === null ? name : `${name} · ${code}`;
            })
            .filter((activity): activity is string => activity !== null),
        })),
    ),

    // How to reach it, as the registry records it.
    phone: stringOrNull(contact['phone_number']),
    mobile: stringOrNull(contact['mobile_number']),
    email: stringOrNull(contact['email']),
    website: stringOrNull(contact['website_url']),

    // Its fiscal year.
    fiscal_year_end: fiscalEnd,
    fiscal_calendar: text(fiscal['calendar_type']),
    fiscal_is_first: booleanOrNull(fiscal['is_first']),
    fiscal_end_year: numberOrNull(fiscal['end_year']),

    // Liquidation.
    in_liquidation: booleanOrNull(v['in_liquidation_process']),
    liquidators: liquidators.people,
    liquidator_businesses: liquidators.businesses,
    // Counted only where the answer lists liquidators at all, even as an empty list.
    liquidators_total: Array.isArray(v['liquidators']) ? liquidators.total : null,

    // Who runs it, and its boards.
    management_structure: text(management['structure_name']),
    dismissal_method: text(management['dismissal_method']),
    ...boardsOf(management),
    ...peopleOf(v),
  });
}

export function mapCorporateContract(
  payload: Readonly<Record<string, unknown>>,
  input: Readonly<Record<string, unknown>> = {},
): Bag {
  const v = asRecord(payload['verifications']);
  const management = asRecord(v['management']);
  const setAside = asRecord(v['set_aside_details']);
  const allocation = asRecord(setAside['profit_allocation']);
  const articles = [
    ...asArray(v['articles'])
      .map(asRecord)
      .map((article) => ({
        part: text(article['part_name']),
        text: text(article['text']),
      })),
    // The articles the partners added, each with its own title.
    ...asArray(v['additional_articles'])
      .map(asRecord)
      .map((article) => ({
        part: text(article['part_name']),
        title: text(article['title']),
        text: text(article['text']),
      })),
  ];

  return compact({
    company_name: text(v['company_name']),
    cr_number: registryNumber(v, stringOrNull(input['unn'])),
    contract_date: stringOrNull(v['contract_date']),
    contract_copy_number: numberOrNull(v['contract_copy_number']),
    management_structure: text(management['structure_name']),
    dismissal_method: text(management['dismissal_method']),
    capital: numberOrNull(v['commercial_registration_capital']),
    ...capitalOf(v['capital_information']),
    profit_set_aside_pct: numberOrNull(allocation['percentage']),
    set_aside_enabled: booleanOrNull(setAside['is_set_aside_enabled']),
    set_aside_purpose: text(allocation['purpose']),
    directors_board_members: numberOrNull(asRecord(management['directors_board'])['member_count']),
    partner_decisions: records(
      asArray(v['partner_decision'])
        .map(asRecord)
        .map((decision) => ({
          name: text(decision['name']),
          approve_percentage: numberOrNull(decision['approve_percentage']),
          condition: text(decision['approve_additional_text']),
        }))
        .filter((decision) => decision.name !== null),
    ),
    additional_decision_text: stringOrNull(v['additional_decision_text']),
    notification_channels: names(v['notification_channel']),
    articles: records(articles.filter((article) => article.text !== null)),
    articles_count: articles.length,
    ...boardsOf(management),
    ...peopleOf(v),
  });
}

/** One address as the national address answer gives it, under our names. */
function addressOf(address: Record<string, unknown>): Bag {
  return {
    title: stringOrNull(address['title']),
    line1: stringOrNull(address['address']),
    line2: stringOrNull(address['address2']),
    building_number: stringOrNull(address['building_number']),
    street: stringOrNull(address['street']),
    district: stringOrNull(address['district']),
    city: stringOrNull(address['city']),
    postal_code: stringOrNull(address['post_code']),
    additional_number: stringOrNull(address['additional_number']),
    region: stringOrNull(address['region_name']),
    unit_number: stringOrNull(address['unit_number']),
    latitude: numberOrNull(address['latitude']),
    longitude: numberOrNull(address['longitude']),
    status: stringOrNull(address['status']),
    restriction: stringOrNull(address['restriction']),
    is_primary: booleanOrNull(address['is_primary_address']),
  };
}

export function mapCorporateAddress(payload: Readonly<Record<string, unknown>>): Bag {
  const v = asRecord(payload['verifications']);
  const addresses = asArray(v['addresses']).map(asRecord);
  const primary =
    addresses.find((address) => booleanOrNull(address['is_primary_address']) === true) ??
    addresses[0] ??
    {};
  const main = addressOf(primary);
  const building = stringOrNull(primary['building_number']);
  const postcode = stringOrNull(primary['post_code']);
  const additional = stringOrNull(primary['additional_number']);

  return compact({
    building_number: building,
    street: main['street'],
    district: main['district'],
    city: main['city'],
    postal_code: postcode,
    additional_number: additional,
    region: main['region'],
    unit_number: main['unit_number'],
    latitude: main['latitude'],
    longitude: main['longitude'],
    address_status: main['status'],
    address_title: main['title'],
    address_line1: main['line1'],
    address_line2: main['line2'],
    address_restriction: main['restriction'],
    address_is_primary: main['is_primary'],
    addresses_count: addresses.length,
    // Every address after the primary one, whole.
    other_addresses: records(addresses.filter((address) => address !== primary).map(addressOf)),
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
  const entries = asArray(payload['verifications']).map(asRecord);
  const asked = stringOrNull(input['manager_id']);
  // The entries about the person asked about, or the answer's only one when it does not repeat
  // the identity. A person listed twice, once per position, has the powers of both.
  const matching = entries.filter(
    (entry) => stringOrNull(asRecord(entry['identity'])['id']) === asked,
  );
  const about = matching.length > 0 ? matching : entries.slice(0, 1);
  const manager = about[0] ?? {};
  const id = stringOrNull(asRecord(manager['identity'])['id']) ?? asked;
  const type = personIdentifierType(id);
  const permissions = records(
    about
      .flatMap((entry) => asArray(entry['permissions']))
      .map(asRecord)
      .map((permission) => ({
        name: text(permission['name']),
        method: text(permission['exercise_method_description']),
        can_issue_poa: booleanOrNull(permission['can_issue_poa']),
        can_delegate: booleanOrNull(permission['can_delegate']),
        condition: text(permission['special_condition_text']),
      }))
      .filter((permission) => permission.name !== null),
  );

  const people =
    id && type
      ? records([
          {
            name: text(manager['name']),
            identity_id: id,
            identity_type: type,
            nationality: nationalityOf(manager['nationality']),
            positions: [...new Set(about.flatMap((entry) => positionsOf(entry['positions'])))],
            manager_type: text(manager['type']),
            is_licensed: booleanOrNull(manager['is_licensed']),
            permissions,
            // Whether the registry lists this person as a manager of this company at all.
            listed: Object.keys(manager).length > 0,
          },
        ])
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
  const category = asRecord(speciality['category']);

  return compact({
    ownership: stringOrNull(v['certificate_ownership_verified']),
    name: text(v['name']),
    name_en: english(v['name']),
    gender: stringOrNull(v['gender']),
    national_id_expiry: stringOrNull(v['national_id_expiry_date']),
    certificate_status: stringOrNull(certificate['status']),
    certificate_issue_date: stringOrNull(certificate['issue_date']),
    certificate_expiry_date: stringOrNull(certificate['expiry_date']),
    certificate_revoked_at: stringOrNull(certificate['revoked_at']),
    certificate_canceled_at: stringOrNull(certificate['canceled_at']),
    speciality: text(speciality['name']),
    speciality_en: english(speciality['name']),
    speciality_code: stringOrNull(speciality['code']),
    category: text(category['name']),
    category_en: english(category['name']),
    category_code: stringOrNull(category['code']),
    certificates_count: certificates.length,
    // The person's other certificates, without their numbers: a certificate number is an
    // identifier (rule 4), and only the one asked about is attached to the file.
    other_certificates: records(
      certificates
        .filter((entry) => entry !== certificate)
        .map((entry) => {
          const other = asRecord(entry['speciality']);
          return {
            status: stringOrNull(entry['status']),
            issue_date: stringOrNull(entry['issue_date']),
            expiry_date: stringOrNull(entry['expiry_date']),
            speciality: text(other['name']),
            category: text(asRecord(other['category'])['name']),
            revoked_at: stringOrNull(entry['revoked_at']),
            canceled_at: stringOrNull(entry['canceled_at']),
          };
        }),
    ),
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
  const ownership = verified === true ? 'MATCH' : matchType === 'PARTIAL' ? 'PARTIAL' : 'NO_MATCH';

  return compact({
    ownership,
    match_score: numberOrNull(matching['score']),
    bank_name: text(v['bank_name']),
    bank_name_en: english(v['bank_name']),
    bank_code: stringOrNull(v['bank_code']),
    swift_code: stringOrNull(v['swift_code']),
    account_status: stringOrNull(v['account_status']),
    holder_name: stringOrNull(v['account_holder_name']),
    verification_method: stringOrNull(v['verification_method']),
    // Echoed so the account resolves to one entity per IBAN and a shared account shows
    // up as a link between customers. Held in this bag only, never stored as a value.
    iban: stringOrNull(input['iban']),
    // The same answers again under the names the account entity's mappings read, because a
    // mapping is keyed on its source and one source cannot feed two entities. Kept on the
    // account too, so a customer with two accounts shows each with its own bank, holder and
    // status rather than whichever was checked last.
    account_bank: text(v['bank_name']),
    account_ownership: ownership,
    account_match_score: numberOrNull(matching['score']),
    account_state: stringOrNull(v['account_status']),
    account_holder: stringOrNull(v['account_holder_name']),
    account_swift: stringOrNull(v['swift_code']),
    account_bank_code: stringOrNull(v['bank_code']),
    account_method: stringOrNull(v['verification_method']),
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
