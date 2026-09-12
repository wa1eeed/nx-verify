import type { Queryable } from '../client.js';

/**
 * The three products from docs/03-products.md section 4, as data.
 *
 * This file is a seed, not an implementation. Nothing reads these codes at runtime, and
 * no branch anywhere depends on them. That is the claim rule 8 makes and the one the
 * catalog test checks by defining a fourth product that exists only in that test.
 */

export interface SeedStep {
  stepKey: string;
  seq: number;
  provider: string;
  endpoint: string;
  inputBinding: Record<string, string>;
  dependsOn?: string[];
  required?: boolean;
  cacheTtlDays?: number | null;
  stepWeight?: number;
}

export interface SeedFieldMap {
  stepKey: string;
  sourcePath: string;
  fieldPath: string;
  entityRole?: string;
  entityType?: string | null;
  identifierPath?: string | null;
  identifierTypeSource?: string | null;
  relationType?: string | null;
  validUntilPath?: string | null;
  confidence?: number;
}

export interface SeedProduct {
  code: string;
  nameAr: string;
  nameEn: string;
  subjectType: string;
  inputSchema: Record<string, unknown>;
  isComposite?: boolean;
  partialPolicy?: 'ALL_OR_NOTHING' | 'BEST_EFFORT';
  steps: SeedStep[];
  fieldMap?: SeedFieldMap[];
  /** Ruleset code, resolved to its id at seed time. */
  decisionRuleset?: string;
}

export const SEED_PRODUCTS: readonly SeedProduct[] = [
  {
    code: 'ADDRESS_ONLY',
    nameAr: 'التحقق من العنوان الوطني',
    nameEn: 'National address verification',
    subjectType: 'BUSINESS',
    inputSchema: {
      type: 'object',
      required: ['unn'],
      additionalProperties: false,
      properties: { unn: { type: 'string', pattern: '^7[0-9]{9}$' } },
    },
    steps: [
      {
        stepKey: 'address',
        seq: 1,
        provider: 'stub',
        endpoint: 'business_verification',
        inputBinding: { identifications: '$.subject.unn', type: 'literal:ADDRESS' },
        cacheTtlDays: 30,
      },
    ],
    fieldMap: [
      { stepKey: 'address', sourcePath: '$.city', fieldPath: 'address.national.city' },
      { stepKey: 'address', sourcePath: '$.district', fieldPath: 'address.national.district' },
      {
        stepKey: 'address',
        sourcePath: '$.building_number',
        fieldPath: 'address.national.building_number',
      },
    ],
  },
  {
    code: 'IBAN_OWNERSHIP',
    nameAr: 'التحقق من ملكية الآيبان',
    nameEn: 'IBAN ownership verification',
    subjectType: 'BANK_ACCOUNT',
    inputSchema: {
      type: 'object',
      required: ['iban', 'identifier'],
      properties: {
        iban: { type: 'string', pattern: '^SA[0-9]{22}$' },
        identifier: {
          type: 'object',
          required: ['type', 'value'],
          properties: {
            type: { enum: ['NATIONAL_ID', 'IQAMA', 'CR'] },
            value: { type: 'string' },
          },
        },
        name: { type: 'string' },
      },
    },
    steps: [
      {
        stepKey: 'iban',
        seq: 1,
        provider: 'stub',
        endpoint: 'iban_ownership',
        inputBinding: {
          iban: '$.subject.iban',
          identifier: '$.subject.identifier.value',
          identifier_type: '$.subject.identifier.type',
        },
      },
    ],
    fieldMap: [
      { stepKey: 'iban', sourcePath: '$.match_result', fieldPath: 'iban.ownership' },
      { stepKey: 'iban', sourcePath: '$.bank_name', fieldPath: 'iban.bank' },
      {
        // Creates the account holder as an entity of its own and links it to the IBAN,
        // so the holder appears in the relationship network without a second product.
        stepKey: 'iban',
        sourcePath: '$.account_holder_name',
        fieldPath: 'holder.name',
        entityRole: 'ACCOUNT_HOLDER',
        entityType: 'BUSINESS',
        identifierPath: '$.holder_identifier',
        identifierTypeSource: 'literal:CR',
        relationType: 'HOLDS_ACCOUNT',
        confidence: 0.9,
      },
    ],
  },
  {
    /**
     * Account ownership confirmed with the bank rather than with a registry.
     *
     * The registry product answers whether an IBAN belongs to a holder on record. This
     * one asks the account's own bank, which is what a payout desk actually needs before
     * releasing money, and it returns a match score rather than a yes or no.
     */
    code: 'BANK_ACCOUNT_OWNERSHIP',
    nameAr: 'تأكيد ملكية الحساب البنكي',
    nameEn: 'Bank account ownership confirmation',
    subjectType: 'BANK_ACCOUNT',
    inputSchema: {
      type: 'object',
      required: ['iban', 'holder'],
      additionalProperties: false,
      properties: {
        iban: { type: 'string', pattern: '^SA[0-9]{22}$' },
        holder: {
          type: 'object',
          required: ['type', 'name'],
          additionalProperties: false,
          properties: {
            type: { enum: ['BUSINESS', 'PERSON'] },
            name: { type: 'string', minLength: 2 },
            registration_id: { type: 'string' },
            national_id: { type: 'string' },
          },
        },
      },
    },
    steps: [
      {
        stepKey: 'ownership',
        seq: 1,
        provider: 'stub',
        endpoint: 'bank_account_ownership',
        inputBinding: {
          iban: '$.subject.iban',
          subject_type: '$.subject.holder.type',
          full_name: '$.subject.holder.name',
          registration_id: '$.subject.holder.registration_id',
          national_id: '$.subject.holder.national_id',
          country_code: 'literal:SA',
        },
        required: true,
        // An account can be closed or reassigned between one payout and the next, so a
        // cached answer is the wrong answer.
        cacheTtlDays: 0,
      },
    ],
    fieldMap: [
      { stepKey: 'ownership', sourcePath: '$.match_result', fieldPath: 'account.ownership' },
      { stepKey: 'ownership', sourcePath: '$.account_status', fieldPath: 'account.status' },
      { stepKey: 'ownership', sourcePath: '$.match_score', fieldPath: 'account.match_score' },
      {
        // The name the bank holds, recorded as a fact about the account and not as a new
        // entity. The bank returns a name and no identifier, and inventing the holder
        // from the identifier we asked about would assert a link nobody confirmed.
        stepKey: 'ownership',
        sourcePath: '$.account_holder_name',
        fieldPath: 'holder.name',
      },
    ],
  },
  {
    /**
     * Does the name on the account match the name we were given.
     *
     * A weaker check than ownership and a cheaper one, and it exists because the answer a
     * customer needs before a first payment is often only this.
     */
    code: 'NAME_MATCH',
    nameAr: 'مطابقة الاسم مع حساب بنكي',
    nameEn: 'Bank account name match',
    subjectType: 'BANK_ACCOUNT',
    inputSchema: {
      type: 'object',
      required: ['account_reference', 'full_name'],
      additionalProperties: false,
      properties: {
        account_reference: { type: 'string', minLength: 8 },
        full_name: { type: 'string', minLength: 2 },
      },
    },
    steps: [
      {
        stepKey: 'name',
        seq: 1,
        provider: 'stub',
        endpoint: 'name_match',
        inputBinding: {
          entity_id: '$.subject.account_reference',
          full_name: '$.subject.full_name',
        },
        required: true,
        cacheTtlDays: 7,
      },
    ],
    fieldMap: [
      { stepKey: 'name', sourcePath: '$.match_result', fieldPath: 'holder.name_match' },
      { stepKey: 'name', sourcePath: '$.match_confidence', fieldPath: 'holder.name_confidence' },
    ],
  },
  {
    /**
     * Income, from the account rather than from a payslip.
     *
     * The subject here is a linked account, not a company, and the product exists for the
     * customers who lend: an average and a payment count carry more than a document that
     * can be edited in a word processor.
     */
    code: 'INCOME_VERIFICATION',
    nameAr: 'إثبات الدخل من الحساب البنكي',
    nameEn: 'Bank based income verification',
    subjectType: 'BANK_ACCOUNT',
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
    steps: [
      {
        stepKey: 'income',
        seq: 1,
        provider: 'stub',
        endpoint: 'income_verification',
        inputBinding: {
          entity_id: '$.subject.account_reference',
          start_date: '$.subject.start_date',
          income_type: '$.subject.income_type',
        },
        required: true,
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
    ],
  },
  {
    /**
     * The articles of association on their own.
     *
     * It is a step inside the full company file, and it is also a service somebody buys
     * by itself: a bank asking who may sign does not want the rest. A product is rows, so
     * selling it separately costs a seed entry rather than a second code path.
     */
    code: 'AOA_ONLY',
    nameAr: 'عقد التأسيس',
    nameEn: 'Articles of association',
    subjectType: 'BUSINESS',
    inputSchema: {
      type: 'object',
      required: ['unn'],
      additionalProperties: false,
      properties: { unn: { type: 'string', pattern: '^7[0-9]{9}$' } },
    },
    steps: [
      {
        stepKey: 'aoa',
        seq: 1,
        provider: 'stub',
        endpoint: 'articles_of_association',
        inputBinding: { unified_number: '$.subject.unn' },
        required: true,
        cacheTtlDays: 90,
      },
    ],
    fieldMap: [
      {
        stepKey: 'aoa',
        sourcePath: '$.managers[*].signing_authority',
        fieldPath: 'manager.signing_authority',
        entityRole: 'MANAGER',
        entityType: 'PERSON',
        identifierPath: '@.id',
        identifierTypeSource: '@.id_type',
        relationType: 'MANAGES',
      },
    ],
  },
  {
    /** Whether this named person may sign for this company, and nothing else. */
    code: 'MANAGER_PERMISSIONS',
    nameAr: 'صلاحيات المدير',
    nameEn: 'Manager permissions verification',
    subjectType: 'BUSINESS',
    inputSchema: {
      type: 'object',
      required: ['unn', 'manager'],
      additionalProperties: false,
      properties: {
        unn: { type: 'string', pattern: '^7[0-9]{9}$' },
        manager: {
          type: 'object',
          required: ['id', 'id_type'],
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            id_type: { enum: ['NATIONAL_ID', 'IQAMA'] },
          },
        },
      },
    },
    steps: [
      {
        stepKey: 'manager_auth',
        seq: 1,
        provider: 'stub',
        endpoint: 'manager_permissions',
        inputBinding: {
          unified_number: '$.subject.unn',
          manager_id: '$.subject.manager.id',
          type: 'literal:MANAGER_PERMISSIONS',
        },
        required: true,
        cacheTtlDays: 90,
      },
    ],
    fieldMap: [
      {
        stepKey: 'manager_auth',
        sourcePath: '$.verified',
        fieldPath: 'manager.signing_authority.verified',
        entityRole: 'MANAGER',
        entityType: 'PERSON',
        identifierPath: '$.manager_id',
        identifierTypeSource: 'literal:NATIONAL_ID',
        relationType: 'MANAGES',
      },
    ],
  },
  {
    /**
     * A freelance certificate.
     *
     * The subject is a person and not a company, which is why it is its own product
     * rather than a step: the entity it establishes is of a different type, and the
     * customers who buy it are marketplaces rather than banks.
     */
    code: 'FREELANCER_CERTIFICATE',
    nameAr: 'التحقق من وثيقة العمل الحر',
    nameEn: 'Freelancer certificate verification',
    subjectType: 'FREELANCER',
    inputSchema: {
      type: 'object',
      required: ['certificate_number'],
      additionalProperties: false,
      properties: {
        certificate_number: { type: 'string', minLength: 4 },
        national_id: { type: 'string' },
      },
    },
    steps: [
      {
        stepKey: 'certificate',
        seq: 1,
        provider: 'stub',
        endpoint: 'freelancer_certificate',
        inputBinding: {
          certificate_number: '$.subject.certificate_number',
          national_id: '$.subject.national_id',
        },
        required: true,
        cacheTtlDays: 30,
      },
    ],
    fieldMap: [
      { stepKey: 'certificate', sourcePath: '$.certificate_status', fieldPath: 'freelance.document' },
      { stepKey: 'certificate', sourcePath: '$.activity', fieldPath: 'freelance.activity' },
      { stepKey: 'certificate', sourcePath: '$.expiry_date', fieldPath: 'freelance.expires_on' },
    ],
  },
  {
    /**
     * A title deed.
     *
     * The subject is the property, not its owner, which is what makes this its own entity
     * type: the same deed outlives several owners, and a lender asking about it wants the
     * property's history rather than a person's. The owner is resolved as a separate
     * entity and linked, so "what else does this company own" is answerable later without
     * storing anything extra.
     */
    code: 'PROPERTY_DEED',
    nameAr: 'التحقق من الصك العقاري',
    nameEn: 'Property deed verification',
    subjectType: 'PROPERTY',
    inputSchema: {
      type: 'object',
      required: ['deed_number'],
      additionalProperties: false,
      properties: {
        deed_number: { type: 'string', minLength: 6 },
        owner_identifier: { type: 'string' },
      },
    },
    steps: [
      {
        stepKey: 'deed',
        seq: 1,
        provider: 'stub',
        endpoint: 'property_deed',
        inputBinding: {
          deed_number: '$.subject.deed_number',
          owner_identifier: '$.subject.owner_identifier',
        },
        required: true,
        // Ownership and encumbrances change on a registrar's timetable, not ours, and a
        // stale answer about a mortgage is the expensive kind.
        cacheTtlDays: 0,
      },
    ],
    fieldMap: [
      { stepKey: 'deed', sourcePath: '$.deed_status', fieldPath: 'property.deed' },
      { stepKey: 'deed', sourcePath: '$.property_type', fieldPath: 'property.type' },
      { stepKey: 'deed', sourcePath: '$.city', fieldPath: 'property.city' },
      { stepKey: 'deed', sourcePath: '$.district', fieldPath: 'property.district' },
      { stepKey: 'deed', sourcePath: '$.area_sqm', fieldPath: 'property.area_sqm' },
      {
        stepKey: 'deed',
        sourcePath: '$.owner_name',
        fieldPath: 'property.owner',
        entityRole: 'OWNER',
        entityType: 'BUSINESS',
        identifierPath: '$.owner_identifier',
        identifierTypeSource: 'literal:CR',
        relationType: 'OWNS',
      },
    ],
  },
  {
    code: 'KYB_COMPLETE',
    nameAr: 'التحقق الشامل للمنشأة',
    nameEn: 'Complete business verification',
    subjectType: 'BUSINESS',
    isComposite: true,
    partialPolicy: 'BEST_EFFORT',
    decisionRuleset: 'KYB_DEFAULT',
    inputSchema: {
      type: 'object',
      // The customer sends the unified number or the commercial registration, not both.
      oneOf: [{ required: ['unn'] }, { required: ['cr_number'] }],
      properties: {
        unn: { type: 'string' },
        cr_number: { type: 'string' },
        manager: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            id_type: { enum: ['NATIONAL_ID', 'IQAMA'] },
          },
        },
      },
    },
    steps: [
      {
        stepKey: 'cr_full',
        seq: 1,
        provider: 'stub',
        endpoint: 'business_verification',
        inputBinding: { identifications: '$.subject.unn', cr_number: '$.subject.cr_number' },
        required: true,
        // Registry status changes without notice, so it is never served from cache.
        cacheTtlDays: 0,
        stepWeight: 40,
      },
      {
        stepKey: 'address',
        seq: 2,
        provider: 'stub',
        endpoint: 'business_verification',
        inputBinding: {
          identifications: '$.steps.cr_full.unified_number',
          type: 'literal:ADDRESS',
        },
        dependsOn: ['cr_full'],
        required: false,
        cacheTtlDays: 30,
        stepWeight: 15,
      },
      {
        stepKey: 'aoa',
        seq: 3,
        provider: 'stub',
        endpoint: 'articles_of_association',
        inputBinding: { unified_number: '$.steps.cr_full.unified_number' },
        dependsOn: ['cr_full'],
        required: false,
        cacheTtlDays: 90,
        stepWeight: 15,
      },
      {
        stepKey: 'manager_auth',
        seq: 4,
        provider: 'stub',
        endpoint: 'manager_permissions',
        inputBinding: {
          unified_number: '$.steps.aoa.unified_number',
          manager_id: '$.subject.manager.id',
          type: 'literal:MANAGER_PERMISSIONS',
        },
        dependsOn: ['aoa'],
        required: false,
        cacheTtlDays: 90,
        stepWeight: 20,
      },
      {
        stepKey: 'ubo',
        seq: 5,
        provider: 'stub',
        endpoint: 'ultimate_beneficial_owner',
        inputBinding: { unified_number: '$.steps.cr_full.unified_number' },
        dependsOn: ['cr_full'],
        required: false,
        cacheTtlDays: 90,
        stepWeight: 10,
      },
    ],
    fieldMap: [
      { stepKey: 'cr_full', sourcePath: '$.cr_status', fieldPath: 'cr.status' },
      { stepKey: 'cr_full', sourcePath: '$.company_name', fieldPath: 'cr.core.name' },
      { stepKey: 'cr_full', sourcePath: '$.capital', fieldPath: 'cr.core.capital' },
      { stepKey: 'address', sourcePath: '$.city', fieldPath: 'address.national.city' },
      { stepKey: 'address', sourcePath: '$.district', fieldPath: 'address.national.district' },
      {
        // One row per manager in the array, each resolved to a person entity and linked
        // to the company. This is what makes "this person signs for seven companies"
        // answerable later without storing anything extra.
        stepKey: 'aoa',
        sourcePath: '$.managers[*].signing_authority',
        fieldPath: 'manager.signing_authority',
        entityRole: 'MANAGER',
        entityType: 'PERSON',
        identifierPath: '@.id',
        identifierTypeSource: '@.id_type',
        relationType: 'MANAGES',
      },
      {
        stepKey: 'manager_auth',
        sourcePath: '$.verified',
        fieldPath: 'manager.signing_authority.verified',
        entityRole: 'MANAGER',
        entityType: 'PERSON',
        identifierPath: '$.manager_id',
        identifierTypeSource: 'literal:NATIONAL_ID',
        relationType: 'MANAGES',
      },
      {
        stepKey: 'ubo',
        sourcePath: '$.owners[*].percentage',
        fieldPath: 'owner.percentage',
        entityRole: 'OWNER',
        entityType: 'PERSON',
        identifierPath: '@.id',
        identifierTypeSource: 'literal:NATIONAL_ID',
        relationType: 'OWNS',
      },
    ],
  },
];

export interface SeedOptions {
  /**
   * Overrides the provider named on every step.
   *
   * A product definition names a provider, and which provider serves a step is an
   * operational choice rather than part of the product. Tests that need a distinctive
   * name pass one here instead of rewriting rows afterwards, which silently came undone
   * the next time the seed was applied.
   */
  providerName?: string;
}

export async function applyProductSeed(
  db: Queryable,
  products: readonly SeedProduct[] = SEED_PRODUCTS,
  options: SeedOptions = {},
): Promise<void> {
  for (const product of products) {
    await db.query(
      `INSERT INTO products (code, name_ar, name_en, subject_type, input_schema,
                             is_composite, partial_policy, decision_ruleset)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7,
               (SELECT id FROM decision_rulesets
                WHERE code = $8 AND tenant_id IS NULL))
       ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         name_en = EXCLUDED.name_en,
         subject_type = EXCLUDED.subject_type,
         input_schema = EXCLUDED.input_schema,
         is_composite = EXCLUDED.is_composite,
         partial_policy = EXCLUDED.partial_policy,
         decision_ruleset = EXCLUDED.decision_ruleset`,
      [
        product.code,
        product.nameAr,
        product.nameEn,
        product.subjectType,
        JSON.stringify(product.inputSchema),
        product.isComposite ?? false,
        product.partialPolicy ?? 'BEST_EFFORT',
        product.decisionRuleset ?? null,
      ],
    );

    for (const step of product.steps) {
      await db.query(
        `INSERT INTO product_steps (product_code, step_key, seq, provider, endpoint,
                                    input_binding, depends_on, required, cache_ttl_days,
                                    step_weight)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
         ON CONFLICT (product_code, step_key) DO UPDATE SET
           seq = EXCLUDED.seq,
           provider = EXCLUDED.provider,
           endpoint = EXCLUDED.endpoint,
           input_binding = EXCLUDED.input_binding,
           depends_on = EXCLUDED.depends_on,
           required = EXCLUDED.required,
           cache_ttl_days = EXCLUDED.cache_ttl_days,
           step_weight = EXCLUDED.step_weight`,
        [
          product.code,
          step.stepKey,
          step.seq,
          options.providerName ?? step.provider,
          step.endpoint,
          JSON.stringify(step.inputBinding),
          step.dependsOn ?? [],
          step.required ?? true,
          step.cacheTtlDays ?? null,
          step.stepWeight ?? 1,
        ],
      );
    }

    for (const mapping of product.fieldMap ?? []) {
      await db.query(
        `INSERT INTO step_field_map (product_code, step_key, source_path, field_path,
                                     entity_role, entity_type, identifier_path,
                                     identifier_type_source, relation_type, valid_until_path,
                                     confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (product_code, step_key, source_path) DO UPDATE SET
           field_path = EXCLUDED.field_path,
           entity_role = EXCLUDED.entity_role,
           entity_type = EXCLUDED.entity_type,
           identifier_path = EXCLUDED.identifier_path,
           identifier_type_source = EXCLUDED.identifier_type_source,
           relation_type = EXCLUDED.relation_type,
           valid_until_path = EXCLUDED.valid_until_path,
           confidence = EXCLUDED.confidence`,
        [
          product.code,
          mapping.stepKey,
          mapping.sourcePath,
          mapping.fieldPath,
          mapping.entityRole ?? 'SUBJECT',
          mapping.entityType ?? null,
          mapping.identifierPath ?? null,
          mapping.identifierTypeSource ?? null,
          mapping.relationType ?? null,
          mapping.validUntilPath ?? null,
          mapping.confidence ?? 1,
        ],
      );
    }
  }
}
