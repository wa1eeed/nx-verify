import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';

/**
 * Reading the product catalog.
 *
 * Rule 8: a product is rows. Nothing in this file knows the name of any product, and
 * nothing branches on one. If a function here ever needs a `switch (productCode)`, the
 * design has failed and the fix is a column, not a case.
 */

export type PartialPolicy = 'ALL_OR_NOTHING' | 'BEST_EFFORT';
export type SubjectType = 'BUSINESS' | 'PERSON' | 'FREELANCER' | 'BANK_ACCOUNT' | 'PROPERTY';

export interface ProductStepDefinition {
  stepKey: string;
  seq: number;
  provider: string;
  endpoint: string;
  inputBinding: Readonly<Record<string, string>>;
  dependsOn: readonly string[];
  required: boolean;
  fallbackProvider: string | null;
  cacheTtlDays: number | null;
  stepWeight: number;
}

export interface ProductDefinition {
  code: string;
  nameAr: string;
  nameEn: string;
  subjectType: SubjectType;
  inputSchema: Record<string, unknown>;
  isComposite: boolean;
  partialPolicy: PartialPolicy;
  decisionRuleset: string | null;
  status: 'active' | 'retired';
  steps: ProductStepDefinition[];
}

export async function getProduct(
  tx: TenantTransaction,
  code: string,
): Promise<ProductDefinition | null> {
  const { rows } = await tx.query<{
    code: string;
    name_ar: string;
    name_en: string;
    subject_type: SubjectType;
    input_schema: Record<string, unknown>;
    is_composite: boolean;
    partial_policy: PartialPolicy;
    decision_ruleset: string | null;
    status: 'active' | 'retired';
  }>(
    `SELECT code, name_ar, name_en, subject_type, input_schema, is_composite,
            partial_policy, decision_ruleset, status
     FROM products
     WHERE code = $1 AND status = 'active'
       AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())`,
    [code],
  );

  const product = rows[0];
  if (!product) {
    return null;
  }

  const { rows: stepRows } = await tx.query<{
    step_key: string;
    seq: number;
    provider: string;
    endpoint: string;
    input_binding: Record<string, string>;
    depends_on: string[];
    required: boolean;
    fallback_provider: string | null;
    cache_ttl_days: number | null;
    step_weight: number;
  }>(
    `SELECT step_key, seq, provider, endpoint, input_binding, depends_on, required,
            fallback_provider, cache_ttl_days, step_weight
     FROM product_steps
     WHERE product_code = $1
     ORDER BY seq, step_key`,
    [code],
  );

  return {
    code: product.code,
    nameAr: product.name_ar,
    nameEn: product.name_en,
    subjectType: product.subject_type,
    inputSchema: product.input_schema,
    isComposite: product.is_composite,
    partialPolicy: product.partial_policy,
    decisionRuleset: product.decision_ruleset,
    status: product.status,
    steps: stepRows.map((row) => ({
      stepKey: row.step_key,
      seq: row.seq,
      provider: row.provider,
      endpoint: row.endpoint,
      inputBinding: row.input_binding,
      dependsOn: row.depends_on,
      required: row.required,
      fallbackProvider: row.fallback_provider,
      cacheTtlDays: row.cache_ttl_days,
      stepWeight: row.step_weight,
    })),
  };
}

export async function requireProduct(
  tx: TenantTransaction,
  code: string,
): Promise<ProductDefinition> {
  const product = await getProduct(tx, code);
  if (!product) {
    throw new NxError('NX-4041', { detail: 'unknown or retired product' });
  }
  return product;
}

export interface ProductSummary {
  code: string;
  nameAr: string;
  nameEn: string;
  subjectType: SubjectType;
  inputSchema: Record<string, unknown>;
  isComposite: boolean;
}

/**
 * Feeds GET /v1/products. The customer's own form is generated from input_schema, which
 * is why adding a product needs no change on their side either.
 */
export async function listProducts(tx: TenantTransaction): Promise<ProductSummary[]> {
  const { rows } = await tx.query<{
    code: string;
    name_ar: string;
    name_en: string;
    subject_type: SubjectType;
    input_schema: Record<string, unknown>;
    is_composite: boolean;
  }>(
    `SELECT code, name_ar, name_en, subject_type, input_schema, is_composite
     FROM products
     WHERE status = 'active'
       AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
     ORDER BY code`,
  );

  return rows.map((row) => ({
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    subjectType: row.subject_type,
    inputSchema: row.input_schema,
    isComposite: row.is_composite,
  }));
}
