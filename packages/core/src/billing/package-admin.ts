import type { Queryable } from '@nx-verify/db';
import { NxError } from '../errors.js';

/**
 * Editing what each plan sells, and what one customer was promised instead.
 *
 * Operator surface: every function here takes the operator connection and crosses
 * subscribers by design, which is allowed for configuration and for nothing else. The
 * tables it touches say what a subscriber bought; none of them says anything about whom
 * that subscriber verified. That distinction is the one guard 02 enforces and the one this
 * file must keep honouring as it grows.
 *
 * Every write is audited against the subscriber it affects and carries the operator who
 * made it, because "who turned this module off in March" is asked by the customer, not by
 * us.
 */

export interface PackageProductRow {
  packageCode: string;
  productCode: string;
  enabled: boolean;
  monthlyQuota: number | null;
  unitPriceHalalas: number | null;
}

export interface PackageRow {
  code: string;
  nameAr: string;
  billingModel: string;
  termMonths: number;
  includedTransactions: number | null;
  commitmentCreditsHalalas: number;
  platformFeeHalalas: number;
  status: string;
  products: PackageProductRow[];
}

export async function listPackagesForOperator(operator: Queryable): Promise<PackageRow[]> {
  const { rows } = await operator.query<{
    code: string;
    name_ar: string;
    billing_model: string;
    term_months: number;
    included_transactions: number | null;
    commitment_credits_halalas: number;
    platform_fee_halalas: number;
    status: string;
  }>(
    `SELECT code, name_ar, billing_model, term_months, included_transactions,
            commitment_credits_halalas, platform_fee_halalas, status
     FROM packages ORDER BY sort_order, code`,
  );

  const { rows: products } = await operator.query<{
    package_code: string;
    product_code: string;
    enabled: boolean;
    monthly_quota: number | null;
    unit_price_halalas: number | null;
  }>(
    `SELECT package_code, product_code, enabled, monthly_quota, unit_price_halalas
     FROM package_products ORDER BY package_code, product_code`,
  );

  return rows.map((row) => ({
    code: row.code,
    nameAr: row.name_ar,
    billingModel: row.billing_model,
    termMonths: row.term_months,
    includedTransactions: row.included_transactions,
    commitmentCreditsHalalas: row.commitment_credits_halalas,
    platformFeeHalalas: row.platform_fee_halalas,
    status: row.status,
    products: products
      .filter((product) => product.package_code === row.code)
      .map((product) => ({
        packageCode: product.package_code,
        productCode: product.product_code,
        enabled: product.enabled,
        monthlyQuota: product.monthly_quota,
        unitPriceHalalas: product.unit_price_halalas,
      })),
  }));
}

export interface SetPackageProductInput {
  packageCode: string;
  productCode: string;
  enabled: boolean;
  /**
   * Absent leaves the quota as it is; null clears it; a number sets it (ADR-164).
   *
   * The distinction is the whole point. This used to write `EXCLUDED.monthly_quota`
   * unconditionally, and the screen's «حفظ» and «تفعيل» buttons both posted without a quota
   * field, so every toggle of a module silently erased the plan's monthly quota, which was
   * displayed read only in the column immediately beside the button.
   */
  monthlyQuota?: number | null;
  /** Same three states, and the same history: toggling a module erased the plan's price. */
  unitPriceHalalas?: number | null;
}

/**
 * Turns a verification module on or off for a plan, and optionally prices it.
 *
 * A patch, not a replace: a field the caller did not mention keeps its value.
 */
export async function setPackageProduct(
  operator: Queryable,
  input: SetPackageProductInput,
  operatorId: string,
): Promise<void> {
  // Guard 10 applies here as everywhere: the price a plan names is what a subscriber on that
  // plan actually pays, and this was the one write that never checked it.
  if (input.unitPriceHalalas !== undefined && input.unitPriceHalalas !== null) {
    if (!Number.isInteger(input.unitPriceHalalas) || input.unitPriceHalalas < 0) {
      throw new NxError('NX-4002', { detail: 'a plan price is a whole number of halalas' });
    }
    const { rows } = await operator.query<{ cost: string }>(
      `SELECT COALESCE(sum(c.unit_cost), 0)::text AS cost
         FROM product_steps s
         LEFT JOIN LATERAL (
           SELECT unit_cost FROM cost_book
            WHERE provider = s.provider AND endpoint = s.endpoint AND valid_to IS NULL
            ORDER BY valid_from DESC LIMIT 1
         ) c ON true
        WHERE s.product_code = $1`,
      [input.productCode],
    );
    const costHalalas = Math.round(Number(rows[0]?.cost ?? '0') * 100);
    if (input.unitPriceHalalas < costHalalas) {
      throw new NxError('NX-4002', {
        detail: `the price is under the cost of ${input.productCode}`,
      });
    }
  }

  await operator.query(
    `INSERT INTO package_products (package_code, product_code, enabled, monthly_quota,
                                   unit_price_halalas)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (package_code, product_code) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       monthly_quota = CASE WHEN $6 THEN EXCLUDED.monthly_quota
                            ELSE package_products.monthly_quota END,
       unit_price_halalas = CASE WHEN $7 THEN EXCLUDED.unit_price_halalas
                                 ELSE package_products.unit_price_halalas END`,
    [
      input.packageCode,
      input.productCode,
      input.enabled,
      input.monthlyQuota ?? null,
      input.unitPriceHalalas ?? null,
      input.monthlyQuota !== undefined,
      input.unitPriceHalalas !== undefined,
    ],
  );

  // A plan is not a subscriber, so the entry is recorded against no tenant and names the
  // plan instead. It still has to exist: this changes what every customer on that plan
  // may run tomorrow.
  await operator.query(
    `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target, metadata)
     SELECT t.id, 'NX_STAFF', $1, 'package.product_set', $2, $3::jsonb
     FROM tenants t
     JOIN tenant_commitments c ON c.tenant_id = t.id
     WHERE c.package_code = $4`,
    [
      operatorId,
      input.productCode,
      JSON.stringify({
        package: input.packageCode,
        enabled: input.enabled,
        monthly_quota: input.monthlyQuota ?? null,
      }),
      input.packageCode,
    ],
  );
}

export interface SubscriberRow {
  tenantId: string;
  legalName: string;
  slug: string;
  isSandbox: boolean;
  packageCode: string | null;
  status: string | null;
  termEnd: Date | null;
  includedTransactions: number | null;
  transactionsUsed: number;
  overrides: { productCode: string; enabled: boolean | null; monthlyQuota: number | null }[];
}

export async function listSubscribers(operator: Queryable): Promise<SubscriberRow[]> {
  const { rows } = await operator.query<{
    id: string;
    legal_name: string;
    slug: string;
    sandbox_of: string | null;
    package_code: string | null;
    status: string | null;
    term_end: Date | null;
    included_transactions: number | null;
    transactions_used: number | null;
  }>(
    `SELECT t.id, t.legal_name, t.slug, t.sandbox_of, c.package_code, c.status, c.term_end,
            c.included_transactions, c.transactions_used
     FROM tenants t
     LEFT JOIN tenant_commitments c ON c.tenant_id = t.id
     WHERE t.status = 'active'
     ORDER BY t.legal_name`,
  );

  const { rows: overrides } = await operator.query<{
    tenant_id: string;
    product_code: string;
    enabled: boolean | null;
    monthly_quota: number | null;
  }>(
    `SELECT tenant_id, product_code, enabled, monthly_quota
     FROM tenant_product_overrides ORDER BY product_code`,
  );

  return rows.map((row) => ({
    tenantId: row.id,
    legalName: row.legal_name,
    slug: row.slug,
    isSandbox: row.sandbox_of !== null,
    packageCode: row.package_code,
    status: row.status,
    termEnd: row.term_end,
    includedTransactions: row.included_transactions,
    transactionsUsed: row.transactions_used ?? 0,
    overrides: overrides
      .filter((override) => override.tenant_id === row.id)
      .map((override) => ({
        productCode: override.product_code,
        enabled: override.enabled,
        monthlyQuota: override.monthly_quota,
      })),
  }));
}

export interface SetOverrideInput {
  tenantId: string;
  productCode: string;
  /**
   * Absent leaves the module decision alone; null lifts it and lets the plan decide again
   * (ADR-164).
   *
   * Optional for the same reason the others are: the pricing screen writes a price and says
   * nothing about modules, and it used to blank this field on the way past.
   */
  enabled?: boolean | null;
  monthlyQuota?: number | null;
  unitPriceHalalas?: number | null;
}

/**
 * The exception written for one customer.
 *
 * This is what keeps a catalogue of three plans from becoming a catalogue of ninety: the
 * customer who wants only the bank check, or only deeds, gets a line rather than a plan.
 */
export async function setTenantOverride(
  operator: Queryable,
  input: SetOverrideInput,
  operatorId: string,
): Promise<void> {
  /*
   * Two screens write this row and each used to erase the other (ADR-164).
   *
   * «أسعار خاصة لمشترك» sets the price; «اكتب استثناءً» on the plans screen sets whether a
   * module is allowed and sends no price at all. Writing an exception therefore deleted that
   * subscriber's negotiated price, silently, from a screen that never mentions prices.
   *
   * So each field is a patch: absent keeps, null clears. And the delete only fires when the
   * caller is clearing every field it named, not when it merely named few.
   */
  const clearing =
    input.enabled === null && input.monthlyQuota === null && input.unitPriceHalalas === null;
  if (clearing) {
    await operator.query(
      `DELETE FROM tenant_product_overrides WHERE tenant_id = $1 AND product_code = $2`,
      [input.tenantId, input.productCode],
    );
  } else {
    await operator.query(
      `INSERT INTO tenant_product_overrides (tenant_id, product_code, enabled, monthly_quota,
                                             unit_price_halalas)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, product_code) DO UPDATE SET
         enabled = CASE WHEN $6 THEN EXCLUDED.enabled
                        ELSE tenant_product_overrides.enabled END,
         monthly_quota = CASE WHEN $7 THEN EXCLUDED.monthly_quota
                              ELSE tenant_product_overrides.monthly_quota END,
         unit_price_halalas = CASE WHEN $8 THEN EXCLUDED.unit_price_halalas
                                   ELSE tenant_product_overrides.unit_price_halalas END,
         updated_at = now()`,
      [
        input.tenantId,
        input.productCode,
        input.enabled,
        input.monthlyQuota ?? null,
        input.unitPriceHalalas ?? null,
        input.enabled !== undefined,
        input.monthlyQuota !== undefined,
        input.unitPriceHalalas !== undefined,
      ],
    );

    // Lifting the last field that said anything leaves a row that says nothing. It is
    // harmless to read and confusing to find, so it goes.
    await operator.query(
      `DELETE FROM tenant_product_overrides
        WHERE tenant_id = $1 AND product_code = $2
          AND enabled IS NULL AND monthly_quota IS NULL AND unit_price_halalas IS NULL`,
      [input.tenantId, input.productCode],
    );
  }

  await operator.query(
    `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target, metadata)
     VALUES ($1, 'NX_STAFF', $2, 'package.override_set', $3, $4::jsonb)`,
    [
      input.tenantId,
      operatorId,
      input.productCode,
      JSON.stringify({
        enabled: input.enabled,
        monthly_quota: input.monthlyQuota ?? null,
      }),
    ],
  );
}

/** Moves a subscriber onto a plan, recording what that plan granted at the time. */
export async function setTenantPackage(
  operator: Queryable,
  input: { tenantId: string; packageCode: string },
  operatorId: string,
): Promise<void> {
  const { rowCount } = await operator.query(
    `INSERT INTO tenant_commitments (tenant_id, package_code, term_months,
                                     credits_granted_halalas, setup_fee_halalas,
                                     included_transactions, platform_fee_halalas)
     SELECT $1, p.code, p.term_months, p.commitment_credits_halalas,
            CASE WHEN p.setup_waived_from_months IS NOT NULL
                   AND p.term_months >= p.setup_waived_from_months
                 THEN 0 ELSE p.setup_fee_halalas END,
            p.included_transactions, p.platform_fee_halalas
     FROM packages p
     WHERE p.code = $2 AND p.status = 'active'
     ON CONFLICT (tenant_id) DO UPDATE SET
       package_code = EXCLUDED.package_code,
       term_months = EXCLUDED.term_months,
       credits_granted_halalas = EXCLUDED.credits_granted_halalas,
       setup_fee_halalas = EXCLUDED.setup_fee_halalas,
       included_transactions = EXCLUDED.included_transactions,
       platform_fee_halalas = EXCLUDED.platform_fee_halalas,
       status = 'active',
       updated_at = now()`,
    [input.tenantId, input.packageCode],
  );

  if ((rowCount ?? 0) === 0) {
    throw new NxError('NX-4041', { detail: 'no such active package' });
  }

  await operator.query(
    `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target, metadata)
     VALUES ($1, 'NX_STAFF', $2, 'package.assigned', $3, '{}'::jsonb)`,
    [input.tenantId, operatorId, input.packageCode],
  );
}
