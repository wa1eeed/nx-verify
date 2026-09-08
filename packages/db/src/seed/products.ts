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

export interface SeedProduct {
  code: string;
  nameAr: string;
  nameEn: string;
  subjectType: string;
  inputSchema: Record<string, unknown>;
  isComposite?: boolean;
  partialPolicy?: 'ALL_OR_NOTHING' | 'BEST_EFFORT';
  steps: SeedStep[];
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
  },
  {
    code: 'KYB_COMPLETE',
    nameAr: 'التحقق الشامل للمنشأة',
    nameEn: 'Complete business verification',
    subjectType: 'BUSINESS',
    isComposite: true,
    partialPolicy: 'BEST_EFFORT',
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
  },
];

export async function applyProductSeed(
  db: Queryable,
  products: readonly SeedProduct[] = SEED_PRODUCTS,
): Promise<void> {
  for (const product of products) {
    await db.query(
      `INSERT INTO products (code, name_ar, name_en, subject_type, input_schema,
                             is_composite, partial_policy)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         name_en = EXCLUDED.name_en,
         subject_type = EXCLUDED.subject_type,
         input_schema = EXCLUDED.input_schema,
         is_composite = EXCLUDED.is_composite,
         partial_policy = EXCLUDED.partial_policy`,
      [
        product.code,
        product.nameAr,
        product.nameEn,
        product.subjectType,
        JSON.stringify(product.inputSchema),
        product.isComposite ?? false,
        product.partialPolicy ?? 'BEST_EFFORT',
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
          step.provider,
          step.endpoint,
          JSON.stringify(step.inputBinding),
          step.dependsOn ?? [],
          step.required ?? true,
          step.cacheTtlDays ?? null,
          step.stepWeight ?? 1,
        ],
      );
    }
  }
}
