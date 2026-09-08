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
