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
 *   BANKING      IBAN_BENEFICIARY_NAME    everyone
 *   FREELANCE    FREELANCE_CERTIFICATE    freelancer
 *   PROPERTY     PROPERTY_VERIFICATION    everyone, not enabled at the source yet
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

/** The people inside a registry or articles answer, as mappings. */
function peopleMappings(stepKey: string): SeedFieldMap[] {
  const manager = {
    stepKey,
    entityRole: 'MANAGER',
    entityType: 'PERSON',
    identifierPath: '@.identity_id',
    identifierTypeSource: '@.identity_type',
    relationType: 'MANAGES',
  } as const;
  const partner = {
    stepKey,
    entityRole: 'PARTNER',
    entityType: 'PERSON',
    identifierPath: '@.identity_id',
    identifierTypeSource: '@.identity_type',
    relationType: 'OWNS',
  } as const;
  const partnerBusiness = {
    stepKey,
    entityRole: 'PARTNER',
    entityType: 'BUSINESS',
    identifierPath: '@.cr_number',
    identifierTypeSource: 'literal:CR',
    relationType: 'OWNS',
  } as const;

  return [
    { ...manager, sourcePath: '$.managers[*].name', fieldPath: 'person.name' },
    { ...manager, sourcePath: '$.managers[*].nationality', fieldPath: 'person.nationality' },
    { ...manager, sourcePath: '$.managers[*].positions', fieldPath: 'manager.positions.{subject}' },
    { ...partner, sourcePath: '$.partners[*].name', fieldPath: 'person.name' },
    { ...partner, sourcePath: '$.partners[*].roles', fieldPath: 'partner.roles.{subject}' },
    { ...partner, sourcePath: '$.partners[*].share_count', fieldPath: 'partner.shares.{subject}' },
    {
      ...partner,
      sourcePath: '$.partners[*].profit_pct',
      fieldPath: 'partner.profit_pct.{subject}',
    },
    { ...partnerBusiness, sourcePath: '$.partner_businesses[*].name', fieldPath: 'cr.core.name' },
    {
      ...partnerBusiness,
      sourcePath: '$.partner_businesses[*].share_count',
      fieldPath: 'partner.shares.{subject}',
    },
  ];
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
    nameEn: 'Commercial registration',
    subjectType: 'BUSINESS',
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
      { stepKey: 'registry', sourcePath: '$.company_name', fieldPath: 'cr.core.name' },
      { stepKey: 'registry', sourcePath: '$.status_text', fieldPath: 'cr.status' },
      { stepKey: 'registry', sourcePath: '$.status_code', fieldPath: 'cr.status_code' },
      { stepKey: 'registry', sourcePath: '$.company_kind', fieldPath: 'cr.kind' },
      { stepKey: 'registry', sourcePath: '$.entity_type', fieldPath: 'cr.entity_type' },
      { stepKey: 'registry', sourcePath: '$.legal_form', fieldPath: 'cr.legal_form' },
      { stepKey: 'registry', sourcePath: '$.issue_date', fieldPath: 'cr.issue_date' },
      { stepKey: 'registry', sourcePath: '$.confirmation_date', fieldPath: 'cr.confirmation_date' },
      { stepKey: 'registry', sourcePath: '$.suspension_date', fieldPath: 'cr.suspension_date' },
      { stepKey: 'registry', sourcePath: '$.deletion_date', fieldPath: 'cr.deletion_date' },
      { stepKey: 'registry', sourcePath: '$.capital', fieldPath: 'cr.core.capital' },
      { stepKey: 'registry', sourcePath: '$.headquarters_city', fieldPath: 'cr.headquarters_city' },
      { stepKey: 'registry', sourcePath: '$.activities', fieldPath: 'cr.activities' },
      { stepKey: 'registry', sourcePath: '$.in_liquidation', fieldPath: 'cr.in_liquidation' },
      { stepKey: 'registry', sourcePath: '$.has_ecommerce', fieldPath: 'cr.has_ecommerce' },
      { stepKey: 'registry', sourcePath: '$.is_main_registry', fieldPath: 'cr.is_main' },
      { stepKey: 'registry', sourcePath: '$.license_issuer', fieldPath: 'cr.license_issuer' },
      { stepKey: 'registry', sourcePath: '$.website', fieldPath: 'cr.website' },
      { stepKey: 'registry', sourcePath: '$.fiscal_year_end', fieldPath: 'cr.fiscal_year_end' },
      {
        stepKey: 'registry',
        sourcePath: '$.partners_nationality',
        fieldPath: 'cr.partners_nationality',
      },
      {
        stepKey: 'registry',
        sourcePath: '$.management_structure',
        fieldPath: 'governance.structure',
      },
      {
        stepKey: 'registry',
        sourcePath: '$.managers_total',
        fieldPath: 'governance.managers_total',
      },
      {
        stepKey: 'registry',
        sourcePath: '$.partners_total',
        fieldPath: 'ownership.partners_total',
      },
      ...peopleMappings('registry'),
    ],
  },
  {
    code: 'ARTICLES_OF_ASSOCIATION',
    nameAr: 'عقد التأسيس',
    nameEn: 'Articles of association',
    subjectType: 'BUSINESS',
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
      { stepKey: 'articles', sourcePath: '$.contract_date', fieldPath: 'contract.date' },
      {
        stepKey: 'articles',
        sourcePath: '$.contract_copy_number',
        fieldPath: 'contract.copy_number',
      },
      { stepKey: 'articles', sourcePath: '$.capital', fieldPath: 'contract.capital' },
      { stepKey: 'articles', sourcePath: '$.capital_type', fieldPath: 'contract.capital_type' },
      { stepKey: 'articles', sourcePath: '$.cash_capital', fieldPath: 'contract.cash_capital' },
      {
        stepKey: 'articles',
        sourcePath: '$.in_kind_capital',
        fieldPath: 'contract.in_kind_capital',
      },
      {
        stepKey: 'articles',
        sourcePath: '$.profit_set_aside_pct',
        fieldPath: 'contract.profit_set_aside_pct',
      },
      {
        stepKey: 'articles',
        sourcePath: '$.partner_decisions',
        fieldPath: 'contract.partner_decisions',
      },
      { stepKey: 'articles', sourcePath: '$.articles_count', fieldPath: 'contract.articles_count' },
      // Recorded under the articles' own paths even where the registry answers the same
      // question. Two sources writing one field would make every verification of either
      // look like a change whenever they differ by a day or a word.
      {
        stepKey: 'articles',
        sourcePath: '$.management_structure',
        fieldPath: 'contract.management_structure',
      },
      {
        stepKey: 'articles',
        sourcePath: '$.dismissal_method',
        fieldPath: 'contract.dismissal_method',
      },
      {
        stepKey: 'articles',
        sourcePath: '$.directors_board_members',
        fieldPath: 'contract.board_members',
      },
      { stepKey: 'articles', sourcePath: '$.managers_total', fieldPath: 'contract.managers_total' },
      { stepKey: 'articles', sourcePath: '$.partners_total', fieldPath: 'contract.partners_total' },
      ...peopleMappings('articles'),
    ],
  },
  {
    code: 'MANAGER_AUTHORITY',
    nameAr: 'صلاحيات المدير المفوّض',
    nameEn: 'Authorised manager powers',
    subjectType: 'BUSINESS',
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
      {
        stepKey: 'authority',
        sourcePath: '$.managers[*].name',
        fieldPath: 'person.name',
        entityRole: 'MANAGER',
        entityType: 'PERSON',
        identifierPath: '@.identity_id',
        identifierTypeSource: '@.identity_type',
        relationType: 'MANAGES',
      },
    ],
  },
  {
    code: 'NATIONAL_ADDRESS',
    nameAr: 'العنوان الوطني',
    nameEn: 'National address',
    subjectType: 'BUSINESS',
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
    ],
  },
  {
    code: 'IBAN_VERIFICATION',
    nameAr: 'التحقق من الآيبان',
    nameEn: 'IBAN verification',
    subjectType: 'BUSINESS',
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
    ],
  },
  {
    code: 'IBAN_BENEFICIARY_NAME',
    nameAr: 'اسم صاحب الحساب',
    nameEn: 'Account holder name',
    subjectType: 'BUSINESS',
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
    profileSection: 'BANKING',
    appliesTo: ['COMPANY', 'ESTABLISHMENT', 'FREELANCER'],
    checkOrder: 55,
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
    nameAr: 'وثيقة العمل الحر',
    nameEn: 'Freelance certificate',
    subjectType: 'FREELANCER',
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
    ],
  },
  {
    code: 'PROPERTY_VERIFICATION',
    nameAr: 'التحقق من العقار',
    nameEn: 'Property verification',
    subjectType: 'PROPERTY',
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
];
