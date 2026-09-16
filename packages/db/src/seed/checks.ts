import type { SeedFieldMap, SeedProduct } from './products.js';

/**
 * The verification products a subscriber runs from a customer's file.
 *
 * One product per section of the file, each a single call to the data source, so each is
 * priced and billed as one verification and a full verification is simply several of them
 * (the owner's model: tick the checks, press verify, or verify one section on its own).
 *
 *   section      product                  applies to
 *   REGISTRY     CR_FULL                  company, establishment
 *   CONTRACT     ARTICLES_OF_ASSOCIATION  company
 *   MANAGERS     MANAGER_AUTHORITY        company, establishment (one call per manager)
 *   ADDRESS      NATIONAL_ADDRESS         company, establishment
 *   BANKING      IBAN_VERIFICATION        everyone
 *   FREELANCE    FREELANCE_CERTIFICATE    freelancer
 *   PROPERTY     PROPERTY_VERIFICATION    everyone, not enabled at the source yet
 *   INCOME       INCOME_VERIFICATION      establishment, freelancer, awaiting a consent flow
 *
 * Each names the module that sells it (migration 0051), which is what a subscriber is given
 * or refused. Section and module carry the same name today because each module draws exactly
 * one section.
 *
 * The account holder's name, IBAN_BENEFICIARY_NAME, is sold through the API and offered on
 * no screen. The IBAN check already brings the holder's name and how well it matches, which
 * is the one banking row of the request screen (handoff screen 02), and a second row asking
 * the same account the same question would be a second charge for one answer.
 *
 * Each step names the data source and falls back to the internal sandbox data, which is
 * only ever registered for a sandbox workspace without its own connection. Production has
 * no fallback registered, so a production call can never be answered by test data.
 *
 * The field paths are ours (rule 8). People found inside an answer, the managers and the
 * partners, become entities of their own and are linked to the company, which is what
 * makes "this manager also manages that company" answerable. What is true of a person only
 * within one company, their positions and powers there, is recorded under a path that
 * carries the company: manager.permissions.{subject}.
 */

const PROVIDER = 'lean';
const SANDBOX = 'stub';

/** Rows for facts about the subject itself, one per key of the answer. */
function fields(stepKey: string, paths: Readonly<Record<string, string>>): SeedFieldMap[] {
  return Object.entries(paths).map(([key, fieldPath]) => ({
    stepKey,
    sourcePath: `$.${key}`,
    fieldPath,
  }));
}

/** Rows for one list of an answer that resolves each entry to an entity of its own. */
function listMappings(
  base: Omit<SeedFieldMap, 'sourcePath' | 'fieldPath'>,
  list: string,
  fields: Readonly<Record<string, string>>,
): SeedFieldMap[] {
  return Object.entries(fields).map(([key, fieldPath]) => ({
    ...base,
    sourcePath: `$.${list}[*].${key}`,
    fieldPath,
  }));
}

/**
 * The people and businesses inside a registry or articles answer, as mappings.
 *
 * What is true of somebody anywhere (a name, a nationality, the authority's name for their
 * document) is recorded on them. What is true of them only in this company (a position, a
 * role, shares, a share of profits) is recorded under a path that carries the company.
 */
function peopleMappings(stepKey: string): SeedFieldMap[] {
  const person = {
    stepKey,
    entityType: 'PERSON',
    identifierPath: '@.identity_id',
    identifierTypeSource: '@.identity_type',
  } as const;
  const business = { ...person, entityType: 'BUSINESS' } as const;
  const manager = { ...person, entityRole: 'MANAGER', relationType: 'MANAGES' } as const;
  const partner = { ...person, entityRole: 'PARTNER', relationType: 'OWNS' } as const;
  const partnerBusiness = { ...business, entityRole: 'PARTNER', relationType: 'OWNS' } as const;
  const guardian = { ...person, entityRole: 'GUARDIAN', relationType: 'REPRESENTS' } as const;

  // What a party is in this company, whether it is a person or a business.
  const partnership = {
    party_type: 'partner.type.{subject}',
    roles: 'partner.roles.{subject}',
    share_count: 'partner.shares.{subject}',
    cash_shares: 'partner.cash_shares.{subject}',
    in_kind_shares: 'partner.in_kind_shares.{subject}',
    profit_pct: 'partner.profit_pct.{subject}',
    loss_pct: 'partner.loss_pct.{subject}',
    license_number: 'partner.license_number.{subject}',
    identity_label: 'party.identity_type',
  };

  return [
    ...listMappings(manager, 'managers', {
      name: 'person.name',
      name_en: 'person.name_en',
      nationality: 'person.nationality',
      identity_label: 'party.identity_type',
      positions: 'manager.positions.{subject}',
      manager_type: 'manager.type.{subject}',
      is_licensed: 'manager.licensed.{subject}',
    }),
    ...listMappings(partner, 'partners', {
      name: 'person.name',
      name_en: 'person.name_en',
      nationality: 'person.nationality',
      guardian: 'partner.guardian.{subject}',
      ...partnership,
    }),
    ...listMappings(partnerBusiness, 'partner_businesses', {
      name: 'cr.core.name',
      name_en: 'cr.core.name_en',
      nationality: 'party.nationality',
      ...partnership,
    }),
    ...listMappings(guardian, 'guardians', {
      name: 'person.name',
      nationality: 'person.nationality',
      identity_label: 'party.identity_type',
      ward: 'guardian.ward.{subject}',
      is_father: 'guardian.is_father.{subject}',
    }),
  ];
}

/** The two boards of a company, under the prefix of the product that read them. */
function boardMappings(stepKey: string, prefix: 'governance' | 'contract'): SeedFieldMap[] {
  const board = (key: string, fieldPath: string): SeedFieldMap => ({
    stepKey,
    sourcePath: `$.${key}`,
    fieldPath: `${prefix}.${fieldPath}`,
  });
  return [
    board('mb_quorum', 'management_board.quorum'),
    board('mb_can_delegate', 'management_board.can_delegate_attendance'),
    board('mb_term_years', 'management_board.term_years'),
    board('mb_way_of_work', 'management_board.way_of_work'),
    board('mb_meeting_place', 'management_board.meeting_place'),
    board('mb_additional_text', 'management_board.additional_text'),
    board('mb_positions', 'management_board.positions'),
    board('db_term_years', 'directors_board.term_years'),
    board('db_reward_value', 'directors_board.reward_value'),
    board('db_reward_max', 'directors_board.reward_max'),
    board('db_way_of_work', 'directors_board.way_of_work'),
    board('db_meeting_place', 'directors_board.meeting_place'),
    board('db_quorum', 'directors_board.quorum'),
    board('db_legal_quorum', 'directors_board.legal_quorum'),
    board('db_can_delegate', 'directors_board.can_delegate_attendance'),
    board('db_call_mechanism', 'directors_board.call_mechanism'),
    board('db_membership_expiry', 'directors_board.membership_expiry_terms'),
    board('db_additional_text', 'directors_board.additional_text'),
    board('db_rewards', 'directors_board.rewards'),
    board('db_positions', 'directors_board.positions'),
  ];
}

/** A company's capital as the registry breaks it down, under the product's own prefix. */
function capitalMappings(stepKey: string, prefix: 'cr' | 'contract'): SeedFieldMap[] {
  return [
    'capital_currency',
    'capital_type',
    'cash_capital',
    'in_kind_capital',
    'share_value',
    'cash_shares',
    'in_kind_shares',
    'stock_type',
    'stock_capital',
    'announced_capital',
    'paid_capital',
    'stock_cash',
    'stock_in_kind',
    'stocks',
  ].map((key) => ({ stepKey, sourcePath: `$.${key}`, fieldPath: `${prefix}.${key}` }));
}

const UNN_SCHEMA = {
  type: 'object',
  required: ['unn'],
  additionalProperties: false,
  properties: { unn: { type: 'string', pattern: '^7[0-9]{9}$' } },
};

export const CHECK_PRODUCTS: readonly SeedProduct[] = [
  {
    code: 'CR_FULL',
    nameAr: 'السجل التجاري',
    nameEn: 'Commercial Registry',
    summaryAr: 'الاسم، النشاط، الحالة، رأس المال، تواريخ الإصدار والانتهاء',
    subjectType: 'BUSINESS',
    moduleCode: 'REGISTRY',
    inputSchema: UNN_SCHEMA,
    profileSection: 'REGISTRY',
    appliesTo: ['COMPANY', 'ESTABLISHMENT'],
    checkOrder: 10,
    steps: [
      {
        stepKey: 'registry',
        seq: 1,
        provider: PROVIDER,
        fallbackProvider: SANDBOX,
        endpoint: 'corporate_full',
        inputBinding: { unn: '$.subject.unn' },
        required: true,
        // Asked because somebody pressed verify: never answered from a cache.
        cacheTtlDays: 0,
      },
    ],
    fieldMap: [
      // The registration number is an identifier: it is attached, hashed and encrypted,
      // and never recorded as a value (rule 4).
      {
        stepKey: 'registry',
        sourcePath: '$.cr_number',
        fieldPath: 'identifier.cr',
        identifierPath: '$.cr_number',
        identifierTypeSource: 'literal:CR',
      },
      ...fields('registry', {
        // The registration.
        company_name: 'cr.core.name',
        company_name_en: 'cr.core.name_en',
        version_number: 'cr.version_number',
        name_language: 'cr.name_language',
        status_text: 'cr.status',
        status_code: 'cr.status_code',
        company_kind: 'cr.kind',
        entity_type: 'cr.entity_type',
        legal_form: 'cr.legal_form',
        entity_characters: 'cr.entity_characters',
        is_main_registry: 'cr.is_main',
        headquarters_city: 'cr.headquarters_city',
        established_on: 'cr.established_on',
        license_based: 'cr.license_based',
        license_issuer: 'cr.license_issuer',
        license_issuer_number: 'cr.license_issuer_number',
        partners_nationality: 'cr.partners_nationality',
        // Its dates, in both calendars.
        issue_date: 'cr.issue_date',
        issue_date_hijri: 'cr.issue_date_hijri',
        confirmation_date: 'cr.confirmation_date',
        confirmation_date_hijri: 'cr.confirmation_date_hijri',
        reactivation_date: 'cr.reactivation_date',
        reactivation_date_hijri: 'cr.reactivation_date_hijri',
        suspension_date: 'cr.suspension_date',
        suspension_date_hijri: 'cr.suspension_date_hijri',
        deletion_date: 'cr.deletion_date',
        deletion_date_hijri: 'cr.deletion_date_hijri',
        // Its capital: the figure on the registration, then its breakdown below.
        capital: 'cr.core.capital',
        // What it does and where it sells.
        activities: 'cr.activities',
        activity_codes: 'cr.activity_codes',
        has_ecommerce: 'cr.has_ecommerce',
        e_stores: 'cr.e_stores',
        // How to reach it, as the registry records it.
        phone: 'cr.contact.phone',
        mobile: 'cr.contact.mobile',
        email: 'cr.contact.email',
        website: 'cr.website',
        // Its fiscal year.
        fiscal_year_end: 'cr.fiscal_year_end',
        fiscal_calendar: 'cr.fiscal_year.calendar',
        fiscal_is_first: 'cr.fiscal_year.is_first',
        fiscal_end_year: 'cr.fiscal_year.end_year',
        // Liquidation.
        in_liquidation: 'cr.in_liquidation',
        liquidators_total: 'cr.liquidators_total',
        // Who runs it.
        management_structure: 'governance.structure',
        dismissal_method: 'governance.dismissal_method',
        managers_total: 'governance.managers_total',
        db_member_count: 'governance.directors_board.member_count',
        partners_total: 'ownership.partners_total',
      }),
      ...capitalMappings('registry', 'cr'),
      ...boardMappings('registry', 'governance'),
      ...peopleMappings('registry'),
      ...listMappings(
        {
          stepKey: 'registry',
          entityType: 'PERSON',
          identifierPath: '@.identity_id',
          identifierTypeSource: '@.identity_type',
          entityRole: 'LIQUIDATOR',
          relationType: 'LIQUIDATES',
        },
        'liquidators',
        {
          name: 'person.name',
          nationality: 'person.nationality',
          identity_label: 'party.identity_type',
          liquidator_type: 'liquidator.type.{subject}',
          positions: 'liquidator.positions.{subject}',
        },
      ),
      ...listMappings(
        {
          stepKey: 'registry',
          entityType: 'BUSINESS',
          identifierPath: '@.identity_id',
          identifierTypeSource: '@.identity_type',
          entityRole: 'LIQUIDATOR',
          relationType: 'LIQUIDATES',
        },
        'liquidator_businesses',
        {
          name: 'cr.core.name',
          nationality: 'party.nationality',
          identity_label: 'party.identity_type',
          liquidator_type: 'liquidator.type.{subject}',
          positions: 'liquidator.positions.{subject}',
        },
      ),
      // A branch, linked to the main registration it belongs to.
      ...listMappings(
        {
          stepKey: 'registry',
          entityType: 'BUSINESS',
          identifierPath: '@.identity_id',
          identifierTypeSource: '@.identity_type',
          entityRole: 'MAIN_REGISTRY',
          relationType: 'BRANCH_OF',
        },
        'main_registry',
        { has_branch: 'registry.branches.{subject}' },
      ),
    ],
  },
  {
    code: 'ARTICLES_OF_ASSOCIATION',
    nameAr: 'عقد التأسيس',
    nameEn: 'Articles of Association',
    summaryAr: 'الشركاء، نسب الملكية، رقم الوثيقة وتاريخها',
    subjectType: 'BUSINESS',
    moduleCode: 'CONTRACT',
    inputSchema: UNN_SCHEMA,
    profileSection: 'CONTRACT',
    // A sole establishment has no articles.
    appliesTo: ['COMPANY'],
    checkOrder: 20,
    steps: [
      {
        stepKey: 'articles',
        seq: 1,
        provider: PROVIDER,
        fallbackProvider: SANDBOX,
        endpoint: 'corporate_contract',
        inputBinding: { unn: '$.subject.unn' },
        required: true,
        cacheTtlDays: 0,
      },
    ],
    fieldMap: [
      ...fields('articles', {
        contract_date: 'contract.date',
        contract_copy_number: 'contract.copy_number',
        articles_count: 'contract.articles_count',
        articles: 'contract.articles',
        capital: 'contract.capital',
        profit_set_aside_pct: 'contract.profit_set_aside_pct',
        set_aside_enabled: 'contract.set_aside_enabled',
        set_aside_purpose: 'contract.set_aside_purpose',
        partner_decisions: 'contract.partner_decisions',
        additional_decision_text: 'contract.additional_decision_text',
        notification_channels: 'contract.notification_channels',
        // Recorded under the articles' own paths even where the registry answers the same
        // question. Two sources writing one field would make every verification of either
        // look like a change whenever they differ by a day or a word.
        management_structure: 'contract.management_structure',
        dismissal_method: 'contract.dismissal_method',
        directors_board_members: 'contract.board_members',
        managers_total: 'contract.managers_total',
        partners_total: 'contract.partners_total',
      }),
      ...capitalMappings('articles', 'contract'),
      ...boardMappings('articles', 'contract'),
      ...peopleMappings('articles'),
    ],
  },
  {
    code: 'MANAGER_AUTHORITY',
    nameAr: 'المدراء المفوضون',
    nameEn: 'Authorized Managers',
    summaryAr: 'الأسماء، الهويات، نوع الصلاحية ونطاقها',
    subjectType: 'BUSINESS',
    moduleCode: 'MANAGERS',
    inputSchema: {
      type: 'object',
      required: ['unn', 'manager_id'],
      additionalProperties: false,
      properties: {
        unn: { type: 'string', pattern: '^7[0-9]{9}$' },
        manager_id: { type: 'string', pattern: '^[12][0-9]{9}$' },
      },
    },
    profileSection: 'MANAGERS',
    appliesTo: ['COMPANY', 'ESTABLISHMENT'],
    checkOrder: 30,
    steps: [
      {
        stepKey: 'authority',
        seq: 1,
        provider: PROVIDER,
        fallbackProvider: SANDBOX,
        endpoint: 'corporate_manager',
        inputBinding: { unn: '$.subject.unn', manager_id: '$.subject.manager_id' },
        required: true,
        cacheTtlDays: 0,
      },
    ],
    fieldMap: [
      {
        stepKey: 'authority',
        sourcePath: '$.managers[*].permissions',
        fieldPath: 'manager.permissions.{subject}',
        entityRole: 'MANAGER',
        entityType: 'PERSON',
        identifierPath: '@.identity_id',
        identifierTypeSource: '@.identity_type',
        relationType: 'MANAGES',
      },
      {
        stepKey: 'authority',
        sourcePath: '$.managers[*].positions',
        fieldPath: 'manager.positions.{subject}',
        entityRole: 'MANAGER',
        entityType: 'PERSON',
        identifierPath: '@.identity_id',
        identifierTypeSource: '@.identity_type',
        relationType: 'MANAGES',
      },
      ...listMappings(
        {
          stepKey: 'authority',
          entityRole: 'MANAGER',
          entityType: 'PERSON',
          identifierPath: '@.identity_id',
          identifierTypeSource: '@.identity_type',
          relationType: 'MANAGES',
        },
        'managers',
        {
          name: 'person.name',
          nationality: 'person.nationality',
          manager_type: 'manager.type.{subject}',
          is_licensed: 'manager.licensed.{subject}',
        },
      ),
    ],
  },
  {
    code: 'NATIONAL_ADDRESS',
    nameAr: 'العنوان الوطني',
    nameEn: 'National Address',
    summaryAr: 'المدينة، الحي، الشارع، الرمز البريدي، الرقم الإضافي',
    subjectType: 'BUSINESS',
    moduleCode: 'ADDRESS',
    inputSchema: UNN_SCHEMA,
    profileSection: 'ADDRESS',
    appliesTo: ['COMPANY', 'ESTABLISHMENT'],
    checkOrder: 40,
    steps: [
      {
        stepKey: 'address',
        seq: 1,
        provider: PROVIDER,
        fallbackProvider: SANDBOX,
        endpoint: 'corporate_address',
        inputBinding: { unn: '$.subject.unn' },
        required: true,
        cacheTtlDays: 0,
      },
    ],
    fieldMap: [
      {
        stepKey: 'address',
        sourcePath: '$.building_number',
        fieldPath: 'address.national.building_number',
      },
      { stepKey: 'address', sourcePath: '$.street', fieldPath: 'address.national.street' },
      { stepKey: 'address', sourcePath: '$.district', fieldPath: 'address.national.district' },
      { stepKey: 'address', sourcePath: '$.city', fieldPath: 'address.national.city' },
      {
        stepKey: 'address',
        sourcePath: '$.postal_code',
        fieldPath: 'address.national.postal_code',
      },
      {
        stepKey: 'address',
        sourcePath: '$.additional_number',
        fieldPath: 'address.national.additional_number',
      },
      { stepKey: 'address', sourcePath: '$.region', fieldPath: 'address.national.region' },
      {
        stepKey: 'address',
        sourcePath: '$.unit_number',
        fieldPath: 'address.national.unit_number',
      },
      { stepKey: 'address', sourcePath: '$.address_status', fieldPath: 'address.national.status' },
      { stepKey: 'address', sourcePath: '$.addresses_count', fieldPath: 'address.national.count' },
      { stepKey: 'address', sourcePath: '$.address_key', fieldPath: 'address.national.key' },
      { stepKey: 'address', sourcePath: '$.latitude', fieldPath: 'address.national.latitude' },
      { stepKey: 'address', sourcePath: '$.longitude', fieldPath: 'address.national.longitude' },
      ...fields('address', {
        address_title: 'address.national.title',
        address_line1: 'address.national.line1',
        address_line2: 'address.national.line2',
        address_restriction: 'address.national.restriction',
        address_is_primary: 'address.national.is_primary',
        other_addresses: 'address.national.others',
      }),
    ],
  },
  {
    code: 'IBAN_VERIFICATION',
    nameAr: 'الآيبان والحساب البنكي',
    nameEn: 'IBAN & Account',
    summaryAr: 'صحة الآيبان، اسم صاحب الحساب، مطابقته لاسم الكيان',
    subjectType: 'BUSINESS',
    moduleCode: 'BANKING',
    inputSchema: {
      type: 'object',
      required: ['iban', 'account_type'],
      additionalProperties: false,
      properties: {
        iban: { type: 'string', pattern: '^SA[0-9]{22}$' },
        account_type: { enum: ['BUSINESS', 'FREELANCER', 'PERSONAL'] },
        unn: { type: 'string', pattern: '^7[0-9]{9}$' },
        national_id: { type: 'string', pattern: '^[12][0-9]{9}$' },
        certificate_number: { type: 'string', minLength: 4 },
      },
    },
    profileSection: 'BANKING',
    appliesTo: ['COMPANY', 'ESTABLISHMENT', 'FREELANCER'],
    checkOrder: 50,
    steps: [
      {
        stepKey: 'iban',
        seq: 1,
        provider: PROVIDER,
        fallbackProvider: SANDBOX,
        endpoint: 'iban_verification',
        inputBinding: {
          iban: '$.subject.iban',
          account_type: '$.subject.account_type',
          unn: '$.subject.unn',
          national_id: '$.subject.national_id',
          certificate_number: '$.subject.certificate_number',
        },
        required: true,
        // An account can be closed or reassigned between one payout and the next.
        cacheTtlDays: 0,
      },
    ],
    fieldMap: [
      { stepKey: 'iban', sourcePath: '$.ownership', fieldPath: 'bank.iban_ownership' },
      { stepKey: 'iban', sourcePath: '$.match_score', fieldPath: 'bank.match_score' },
      { stepKey: 'iban', sourcePath: '$.bank_name', fieldPath: 'bank.name' },
      { stepKey: 'iban', sourcePath: '$.bank_name_en', fieldPath: 'bank.name_en' },
      { stepKey: 'iban', sourcePath: '$.bank_code', fieldPath: 'bank.code' },
      { stepKey: 'iban', sourcePath: '$.swift_code', fieldPath: 'bank.swift_code' },
      { stepKey: 'iban', sourcePath: '$.account_status', fieldPath: 'bank.account_status' },
      { stepKey: 'iban', sourcePath: '$.holder_name', fieldPath: 'bank.holder_name' },
      {
        stepKey: 'iban',
        sourcePath: '$.verification_method',
        fieldPath: 'bank.verification_method',
      },
      {
        // The account as an entity of its own, keyed by the IBAN (hashed, never stored as a
        // value), so one account presented for two customers links the two.
        stepKey: 'iban',
        sourcePath: '$.account_bank',
        fieldPath: 'account.bank',
        entityRole: 'ACCOUNT',
        entityType: 'BANK_ACCOUNT',
        identifierPath: '$.iban',
        identifierTypeSource: 'literal:IBAN',
        relationType: 'HOLDS_ACCOUNT',
      },
      {
        stepKey: 'iban',
        sourcePath: '$.account_ownership',
        fieldPath: 'account.ownership.{subject}',
        entityRole: 'ACCOUNT',
        entityType: 'BANK_ACCOUNT',
        identifierPath: '$.iban',
        identifierTypeSource: 'literal:IBAN',
        relationType: 'HOLDS_ACCOUNT',
      },
      // The rest of what the answer says of the account, on the account, so two accounts of one
      // customer each keep their own.
      ...Object.entries({
        account_match_score: 'account.match_score.{subject}',
        account_state: 'account.status',
        account_holder: 'account.holder_name',
        account_swift: 'account.swift_code',
        account_bank_code: 'account.bank_code',
        account_method: 'account.verification_method',
      }).map(([key, fieldPath]): SeedFieldMap => ({
        stepKey: 'iban',
        sourcePath: `$.${key}`,
        fieldPath,
        entityRole: 'ACCOUNT',
        entityType: 'BANK_ACCOUNT',
        identifierPath: '$.iban',
        identifierTypeSource: 'literal:IBAN',
        relationType: 'HOLDS_ACCOUNT',
      })),
    ],
  },
  {
    code: 'IBAN_BENEFICIARY_NAME',
    nameAr: 'اسم صاحب الحساب',
    nameEn: 'Account Holder Name',
    summaryAr: 'اسم صاحب الحساب وحالة الحساب',
    subjectType: 'BUSINESS',
    moduleCode: 'BANKING',
    inputSchema: {
      type: 'object',
      required: ['iban'],
      additionalProperties: false,
      properties: {
        iban: { type: 'string', pattern: '^SA[0-9]{22}$' },
        unn: { type: 'string' },
        national_id: { type: 'string' },
        certificate_number: { type: 'string' },
      },
    },
    steps: [
      {
        stepKey: 'beneficiary',
        seq: 1,
        provider: PROVIDER,
        fallbackProvider: SANDBOX,
        endpoint: 'iban_beneficiary_name',
        inputBinding: { iban: '$.subject.iban' },
        required: true,
        cacheTtlDays: 0,
      },
    ],
    fieldMap: [
      {
        stepKey: 'beneficiary',
        sourcePath: '$.beneficiary_name',
        fieldPath: 'bank.beneficiary_name',
      },
      { stepKey: 'beneficiary', sourcePath: '$.account_status', fieldPath: 'bank.account_status' },
    ],
  },
  {
    code: 'FREELANCE_CERTIFICATE',
    nameAr: 'شهادة الفريلانسر',
    nameEn: 'Freelancer Certificate',
    summaryAr: 'الاسم، التخصص، التصنيف، حالة الوثيقة، تواريخ الإصدار والانتهاء',
    subjectType: 'FREELANCER',
    moduleCode: 'FREELANCE',
    inputSchema: {
      type: 'object',
      required: ['national_id', 'certificate_number'],
      additionalProperties: false,
      properties: {
        national_id: { type: 'string', pattern: '^[12][0-9]{9}$' },
        certificate_number: { type: 'string', pattern: '^FL-[0-9]{6,12}$' },
      },
    },
    profileSection: 'FREELANCE',
    appliesTo: ['FREELANCER'],
    checkOrder: 10,
    steps: [
      {
        stepKey: 'certificate',
        seq: 1,
        provider: PROVIDER,
        fallbackProvider: SANDBOX,
        endpoint: 'freelancer_verification',
        inputBinding: {
          national_id: '$.subject.national_id',
          certificate_number: '$.subject.certificate_number',
        },
        required: true,
        cacheTtlDays: 0,
      },
    ],
    fieldMap: [
      { stepKey: 'certificate', sourcePath: '$.ownership', fieldPath: 'freelance.ownership' },
      { stepKey: 'certificate', sourcePath: '$.name', fieldPath: 'person.name' },
      { stepKey: 'certificate', sourcePath: '$.gender', fieldPath: 'person.gender' },
      {
        stepKey: 'certificate',
        sourcePath: '$.national_id_expiry',
        fieldPath: 'person.national_id_expiry',
      },
      {
        stepKey: 'certificate',
        sourcePath: '$.certificate_status',
        fieldPath: 'freelance.certificate_status',
        // Current until the authority's own expiry date, not an estimate.
        validUntilPath: '$.certificate_expiry_date',
      },
      {
        stepKey: 'certificate',
        sourcePath: '$.certificate_issue_date',
        fieldPath: 'freelance.issue_date',
      },
      {
        stepKey: 'certificate',
        sourcePath: '$.certificate_expiry_date',
        fieldPath: 'freelance.expiry_date',
      },
      { stepKey: 'certificate', sourcePath: '$.speciality', fieldPath: 'freelance.speciality' },
      { stepKey: 'certificate', sourcePath: '$.category', fieldPath: 'freelance.category' },
      ...fields('certificate', {
        name_en: 'person.name_en',
        certificate_revoked_at: 'freelance.revoked_at',
        certificate_canceled_at: 'freelance.canceled_at',
        speciality_en: 'freelance.speciality_en',
        speciality_code: 'freelance.speciality_code',
        category_en: 'freelance.category_en',
        category_code: 'freelance.category_code',
        certificates_count: 'freelance.certificates_count',
        other_certificates: 'freelance.other_certificates',
      }),
    ],
  },
  {
    code: 'PROPERTY_VERIFICATION',
    nameAr: 'التحقق من العقار',
    nameEn: 'Property Verification',
    summaryAr: 'رقم الصك وحالة العقار',
    subjectType: 'PROPERTY',
    moduleCode: 'PROPERTY',
    inputSchema: {
      type: 'object',
      required: ['property_number'],
      additionalProperties: false,
      properties: {
        property_number: { type: 'string', pattern: '^[0-9]{10,20}$' },
        owner_id: { type: 'string' },
      },
    },
    profileSection: 'PROPERTY',
    appliesTo: ['COMPANY', 'ESTABLISHMENT', 'FREELANCER'],
    checkOrder: 70,
    // Documented by the data source and not enabled on our account. Shown so the offer is
    // honest about what is coming, never runnable until the panel marks it available.
    availability: 'COMING_SOON',
    steps: [
      {
        stepKey: 'property',
        seq: 1,
        provider: PROVIDER,
        fallbackProvider: SANDBOX,
        endpoint: 'property_verification',
        inputBinding: {
          property_number: '$.subject.property_number',
          owner_id: '$.subject.owner_id',
        },
        required: true,
        cacheTtlDays: 0,
      },
    ],
    fieldMap: [
      { stepKey: 'property', sourcePath: '$.property_status', fieldPath: 'property.status' },
    ],
  },
  {
    /**
     * Income, read from the customer's own account rather than from a payslip.
     *
     * The subject is a bank account, which is why this belongs to the individuals' side of a
     * file: an establishment and a freelancer are natural persons with a personal account, and
     * a company's income is revenue, a different question with a different authority.
     *
     * What is asked for is the fuller of the two answers available: the monthly average and
     * the payment count, and with them where each credit came from and how steady it has been
     * across one, two, three and six months. A lender's question is not «what does he earn»
     * but «will he earn it again next month», and only the stability figures answer that.
     *
     * COMING_SOON, and for a reason no panel switch can lift: this reads a private account, so
     * it needs that person's own consent, and the consent journey is not built. Showing it as
     * runnable would be a promise the platform cannot keep (ADR-137).
     */
    code: 'INCOME_VERIFICATION',
    nameAr: 'الدخل من الحساب البنكي',
    nameEn: 'Bank based income verification',
    summaryAr: 'متوسط الدخل الشهري ومصادره وثباته، من الحساب البنكي بموافقة صاحبه.',
    subjectType: 'BANK_ACCOUNT',
    moduleCode: 'INCOME',
    inputSchema: {
      type: 'object',
      required: ['account_reference'],
      additionalProperties: false,
      properties: {
        account_reference: { type: 'string', minLength: 8 },
        start_date: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
        income_type: { enum: ['SALARY', 'NON_SALARY', 'ALL'] },
      },
    },
    profileSection: 'INCOME',
    appliesTo: ['ESTABLISHMENT', 'FREELANCER'],
    checkOrder: 60,
    availability: 'COMING_SOON',
    steps: [
      {
        stepKey: 'income',
        seq: 1,
        provider: PROVIDER,
        fallbackProvider: SANDBOX,
        endpoint: 'income_verification',
        inputBinding: {
          entity_id: '$.subject.account_reference',
          start_date: '$.subject.start_date',
          income_type: '$.subject.income_type',
        },
        required: true,
        // Income is a rolling window over months of transactions, and asking again the same
        // week returns the same months. A week of cache, as the other bank facts have.
        cacheTtlDays: 7,
      },
    ],
    fieldMap: [
      {
        stepKey: 'income',
        sourcePath: '$.average_monthly_income',
        fieldPath: 'income.monthly_average',
      },
      { stepKey: 'income', sourcePath: '$.income_currency', fieldPath: 'income.currency' },
      { stepKey: 'income', sourcePath: '$.income_payment_count', fieldPath: 'income.payments' },
      { stepKey: 'income', sourcePath: '$.last_income_at', fieldPath: 'income.last_seen' },
      ...fields('income', {
        first_income_at: 'income.first_seen',
        income_total: 'income.total',
        income_monthly_count: 'income.monthly_payments',
        income_received_average: 'income.received_average',
        income_highest_month: 'income.highest_month',
        income_highest_amount: 'income.highest_amount',
        income_lowest_month: 'income.lowest_month',
        income_lowest_amount: 'income.lowest_amount',
        income_months: 'income.months',
        income_sources: 'income.sources',
        income_variation_ratio: 'income.variation_ratio',
        income_monthly_change: 'income.monthly_change',
        other_income_currency: 'income.other.currency',
        other_income_total: 'income.other.total',
        other_income_monthly_average: 'income.other.monthly_average',
        other_income_count: 'income.other.payments',
        other_income_sources: 'income.other.sources',
      }),
    ],
  },
];
