import type { Queryable } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { recordOperatorAudit } from '../operators/audit.js';
import { operatorCan, type OperatorIdentity } from '../operators/accounts.js';
import { halalasToDecimalString } from './money.js';

/**
 * What the platform sells and for how much (handoff screen 05, «الأسعار والمنتجات»).
 *
 * Four things staff set, on the operator connection, each audited against the person who set
 * it:
 *
 *   the list price of each check    a new versioned row in the price book, never an edit of
 *                                   the old one, and never under what the check costs us
 *                                   (guard 10). Under 30% margin it is allowed and said.
 *   credit bundles                  operations bought once and spent over months. An
 *                                   operation can pay for any check, so its price must cover
 *                                   the dearest call a check makes.
 *   plans                           a monthly fee, the operations it includes, and the price
 *                                   of each one past them.
 *   special prices                  a price for one product, or a discount on all of them,
 *                                   for one subscriber. Neither may go under cost.
 *
 * Costs are read per call, from the cost book, for the provider each step names: a check that
 * makes two calls costs two calls (guard 10).
 */

/** What we keep of every riyal sold, at the least, before a price is flagged. */
export const MINIMUM_MARGIN_PCT = 30;

function assertPricing(actor: OperatorIdentity): void {
  if (!operatorCan(actor.role, 'pricing')) {
    throw new NxError('NX-4031', { detail: 'this role does not change prices' });
  }
}

function marginOf(price: number | null, cost: number): number | null {
  return price === null || price <= 0 ? null : Math.round(((price - cost) / price) * 100);
}

/** The cost of one run of each product: one call per step, at the step provider's cost. */
async function costsByProduct(db: Queryable): Promise<Map<string, number>> {
  const { rows } = await db.query<{ product_code: string; cost: string }>(
    `SELECT s.product_code, COALESCE(sum(c.unit_cost), 0)::text AS cost
     FROM product_steps s
     LEFT JOIN LATERAL (
       SELECT unit_cost FROM cost_book
       WHERE provider = s.provider AND endpoint = s.endpoint AND valid_to IS NULL
       ORDER BY valid_from DESC LIMIT 1
     ) c ON true
     GROUP BY s.product_code`,
  );
  return new Map(rows.map((row) => [row.product_code, Math.round(Number(row.cost) * 100)]));
}

export interface ProductPricingRow {
  productCode: string;
  nameAr: string;
  /** One run's cost to us, in halalas. */
  costHalalas: number;
  /** The default list price, before VAT. Null when none is in force. */
  priceHalalas: number | null;
  marginPct: number | null;
  /** Runs across every subscriber in the last thirty days, from the monthly counters. */
  runs30: number;
  status: 'active' | 'suspended' | 'retired';
  availability: 'AVAILABLE' | 'COMING_SOON';
}

/**
 * The checks of the catalogue with their cost, price, margin and use.
 *
 * Use is read from the margin counters, the only cross-subscriber shape staff may read
 * (ADR-080). They count by month, so thirty days are this month and the part of last month
 * that falls inside them, in proportion.
 */
export async function listProductPricing(
  db: Queryable,
  now: Date = new Date(),
): Promise<ProductPricingRow[]> {
  const costs = await costsByProduct(db);
  const { rows } = await db.query<{
    code: string;
    name_ar: string;
    status: ProductPricingRow['status'];
    availability: ProductPricingRow['availability'];
    unit_price: string | null;
  }>(
    `SELECT p.code, p.name_ar, p.status, p.availability,
            (SELECT b.unit_price::text FROM price_book b
             WHERE b.product_code = p.code AND b.tenant_id IS NULL AND b.contract_id IS NULL
               AND b.tier_min = 0 AND b.valid_to IS NULL
             ORDER BY b.valid_from DESC LIMIT 1) AS unit_price
     FROM products p
     WHERE p.profile_section IS NOT NULL AND p.status <> 'retired'
     ORDER BY array_position(
                ARRAY['REGISTRY', 'CONTRACT', 'MANAGERS', 'ADDRESS', 'FREELANCE', 'BANKING', 'PROPERTY'],
                p.profile_section
              ),
              p.check_order, p.code`,
  );

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previousStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const daysThisMonth = (now.getTime() - monthStart.getTime()) / 86_400_000;
  const daysPrevious = (monthStart.getTime() - previousStart.getTime()) / 86_400_000;
  const share = Math.max(0, Math.min(1, (30 - daysThisMonth) / daysPrevious));
  // The month as text: a date column read into a JavaScript Date lands on local midnight, which
  // east of Greenwich is the last day of the month before.
  const { rows: counters } = await db.query<{
    product_code: string;
    period_start: string;
    runs: string;
  }>(
    `SELECT product_code, period_start::text AS period_start, sum(runs)::text AS runs
     FROM margin_counters
     WHERE period_start >= $1::date
     GROUP BY product_code, period_start`,
    [previousStart.toISOString().slice(0, 10)],
  );
  const runs = new Map<string, number>();
  for (const counter of counters) {
    const current = counter.period_start >= monthStart.toISOString().slice(0, 10);
    runs.set(
      counter.product_code,
      (runs.get(counter.product_code) ?? 0) + Number(counter.runs) * (current ? 1 : share),
    );
  }

  return rows.map((row) => {
    const cost = costs.get(row.code) ?? 0;
    const price = row.unit_price === null ? null : Math.round(Number(row.unit_price) * 100);
    return {
      productCode: row.code,
      nameAr: row.name_ar,
      costHalalas: cost,
      priceHalalas: price,
      marginPct: marginOf(price, cost),
      runs30: Math.round(runs.get(row.code) ?? 0),
      status: row.status,
      availability: row.availability,
    };
  });
}

export interface PriceChange {
  productCode: string;
  priceHalalas: number;
  marginPct: number;
  /** Allowed, and under the margin staff should keep. */
  thinMargin: boolean;
}

/** A new list price for a check: a new row in force from now, the old one closed. */
export async function setListPrice(
  db: Queryable,
  actor: OperatorIdentity,
  productCode: string,
  priceHalalas: number,
): Promise<PriceChange | null> {
  assertPricing(actor);
  if (!Number.isInteger(priceHalalas) || priceHalalas <= 0) {
    throw new NxError('NX-4002', { detail: 'a price is a positive amount' });
  }
  const cost = (await costsByProduct(db)).get(productCode);
  if (cost === undefined) {
    throw new NxError('NX-4041', { detail: 'no such product' });
  }
  if (priceHalalas < cost) {
    throw new NxError('NX-4002', { detail: `the price is under the cost of ${productCode}` });
  }

  const { rows } = await db.query<{ unit_price: string }>(
    `SELECT unit_price::text FROM price_book
     WHERE product_code = $1 AND tenant_id IS NULL AND contract_id IS NULL AND tier_min = 0
       AND valid_to IS NULL`,
    [productCode],
  );
  const open = rows[0];
  const previous = open === undefined ? null : Math.round(Number(open.unit_price) * 100);
  if (previous === priceHalalas) {
    return null;
  }

  // One statement, so the old row closes at the very instant the new one opens: no moment in
  // between has no price, and no moment has two.
  await db.query(
    `WITH closed AS (
       UPDATE price_book SET valid_to = now()
       WHERE product_code = $1 AND tenant_id IS NULL AND contract_id IS NULL AND tier_min = 0
         AND valid_to IS NULL
       RETURNING negative_pct, cache_pct, version
     )
     INSERT INTO price_book (product_code, unit_price, negative_pct, cache_pct, version, valid_from)
     VALUES (
       $1, $2::numeric,
       COALESCE((SELECT negative_pct FROM closed LIMIT 1), 0.50),
       COALESCE((SELECT cache_pct FROM closed LIMIT 1), 1.00),
       COALESCE((SELECT max(version) FROM closed), 0) + 1,
       now()
     )`,
    [productCode, halalasToDecimalString(priceHalalas)],
  );

  const marginPct = marginOf(priceHalalas, cost) ?? 0;
  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'pricing.list_price',
    target: `pricing:product:${productCode}`,
    metadata: { from: previous, to: priceHalalas, margin_pct: marginPct },
  });
  return { productCode, priceHalalas, marginPct, thinMargin: marginPct < MINIMUM_MARGIN_PCT };
}

/** Takes a check off sale for now, or puts it back. */
export async function setProductOnSale(
  db: Queryable,
  actor: OperatorIdentity,
  productCode: string,
  onSale: boolean,
): Promise<void> {
  assertPricing(actor);
  const { rowCount } = await db.query(
    `UPDATE products SET status = $2
     WHERE code = $1 AND status <> 'retired' AND status <> $2`,
    [productCode, onSale ? 'active' : 'suspended'],
  );
  if ((rowCount ?? 0) > 0) {
    await recordOperatorAudit(db, {
      operatorId: actor.id,
      action: onSale ? 'pricing.product_resumed' : 'pricing.product_suspended',
      target: `pricing:product:${productCode}`,
    });
  }
}

// ── bundles ───────────────────────────────────────────────────────────────────────────────

export interface CreditBundle {
  code: string;
  operations: number;
  priceHalalas: number;
  validityMonths: number;
  status: 'active' | 'retired';
  perOperationHalalas: number;
  /** Below the smallest bundle's price per operation, in whole percent. Null for that one. */
  discountPct: number | null;
}

export async function listCreditBundles(
  db: Queryable,
  options: { includeRetired?: boolean } = {},
): Promise<CreditBundle[]> {
  const { rows } = await db.query<{
    code: string;
    operations: number;
    price_halalas: string;
    validity_months: number;
    status: 'active' | 'retired';
  }>(
    `SELECT code, operations, price_halalas::text, validity_months, status
     FROM credit_bundles
     WHERE $1 OR status = 'active'
     ORDER BY operations, code`,
    [options.includeRetired === true],
  );
  const bundles = rows.map((row) => ({
    code: row.code,
    operations: row.operations,
    priceHalalas: Number(row.price_halalas),
    validityMonths: row.validity_months,
    status: row.status,
    perOperationHalalas: Number(row.price_halalas) / row.operations,
  }));
  const base = bundles.find((bundle) => bundle.status === 'active')?.perOperationHalalas ?? null;
  return bundles.map((bundle) => {
    const discount = base === null ? 0 : Math.round((1 - bundle.perOperationHalalas / base) * 100);
    return {
      ...bundle,
      perOperationHalalas: Math.round(bundle.perOperationHalalas),
      discountPct: discount > 0 ? discount : null,
    };
  });
}

/** The dearest run any check on sale makes: what one operation of a bundle must cover. */
async function dearestRun(db: Queryable): Promise<number> {
  const costs = await costsByProduct(db);
  const { rows } = await db.query<{ code: string }>(
    `SELECT code FROM products
     WHERE profile_section IS NOT NULL AND status = 'active' AND availability = 'AVAILABLE'`,
  );
  return Math.max(0, ...rows.map((row) => costs.get(row.code) ?? 0));
}

export interface BundleInput {
  operations: number;
  priceHalalas: number;
  validityMonths?: number;
}

export async function addCreditBundle(
  db: Queryable,
  actor: OperatorIdentity,
  input: BundleInput,
): Promise<CreditBundle> {
  assertPricing(actor);
  const validity = input.validityMonths ?? 12;
  if (
    !Number.isInteger(input.operations) ||
    input.operations <= 0 ||
    input.operations > 1_000_000
  ) {
    throw new NxError('NX-4002', { detail: 'a bundle holds a positive number of operations' });
  }
  if (!Number.isInteger(input.priceHalalas) || input.priceHalalas <= 0) {
    throw new NxError('NX-4002', { detail: 'a bundle has a positive price' });
  }
  if (!Number.isInteger(validity) || validity < 1 || validity > 36) {
    throw new NxError('NX-4002', { detail: 'a bundle lasts 1 to 36 months' });
  }
  if (input.priceHalalas / input.operations < (await dearestRun(db))) {
    throw new NxError('NX-4002', { detail: 'an operation of this bundle is priced under cost' });
  }
  const code = `BUNDLE_${input.operations}`;
  await db.query(
    `INSERT INTO credit_bundles (code, operations, price_halalas, validity_months, sort_order, updated_by)
     VALUES ($1, $2, $3, $4, $2, $5)
     ON CONFLICT (code) DO UPDATE SET
       price_halalas = EXCLUDED.price_halalas, validity_months = EXCLUDED.validity_months,
       status = 'active', updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [code, input.operations, input.priceHalalas, validity, actor.id],
  );
  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'pricing.bundle_saved',
    target: `pricing:bundle:${code}`,
    metadata: { operations: input.operations, price: input.priceHalalas, months: validity },
  });
  const bundle = (await listCreditBundles(db)).find((entry) => entry.code === code);
  return bundle as CreditBundle;
}

export async function retireCreditBundle(
  db: Queryable,
  actor: OperatorIdentity,
  code: string,
): Promise<void> {
  assertPricing(actor);
  const { rowCount } = await db.query(
    `UPDATE credit_bundles SET status = 'retired', updated_at = now(), updated_by = $2
     WHERE code = $1 AND status = 'active'`,
    [code, actor.id],
  );
  if ((rowCount ?? 0) > 0) {
    await recordOperatorAudit(db, {
      operatorId: actor.id,
      action: 'pricing.bundle_retired',
      target: `pricing:bundle:${code}`,
    });
  }
}

// ── plans ────────────────────────────────────────────────────────────────────────────────

export interface PlanSummary {
  code: string;
  nameAr: string;
  billingModel: string;
  /** Per month, before VAT. Zero for a plan priced by negotiation. */
  monthlyFeeHalalas: number;
  includedTransactions: number | null;
  overageUnitHalalas: number | null;
  /** No fee and no fixed operations: the terms are agreed per subscriber. */
  negotiated: boolean;
}

export async function listPlans(db: Queryable): Promise<PlanSummary[]> {
  const { rows } = await db.query<{
    code: string;
    name_ar: string;
    billing_model: string;
    platform_fee_halalas: number;
    included_transactions: number | null;
    overage_unit_halalas: number | null;
    term_months: number;
  }>(
    `SELECT code, name_ar, billing_model, platform_fee_halalas, included_transactions,
            overage_unit_halalas, term_months
     FROM packages
     WHERE status = 'active' AND code <> 'SANDBOX'
     ORDER BY sort_order, code`,
  );
  return rows.map((row) => ({
    code: row.code,
    nameAr: row.name_ar,
    billingModel: row.billing_model,
    monthlyFeeHalalas:
      row.billing_model === 'ANNUAL'
        ? Math.round(row.platform_fee_halalas / 12)
        : row.platform_fee_halalas,
    includedTransactions: row.included_transactions,
    overageUnitHalalas: row.overage_unit_halalas,
    negotiated: row.platform_fee_halalas === 0 && row.included_transactions === null,
  }));
}

export interface PlanInput {
  code: string;
  nameAr: string;
  nameEn: string;
  monthlyFeeHalalas: number;
  includedTransactions: number;
  overageUnitHalalas: number;
}

/** A monthly plan, with every check on sale enabled in it at the list price. */
export async function addPlan(
  db: Queryable,
  actor: OperatorIdentity,
  input: PlanInput,
): Promise<PlanSummary> {
  assertPricing(actor);
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(code)) {
    throw new NxError('NX-4002', {
      detail: 'a plan code is capital letters, digits and underscores',
    });
  }
  if (input.nameAr.trim().length < 2 || input.nameEn.trim().length < 2) {
    throw new NxError('NX-4002', { detail: 'a plan has an Arabic and an English name' });
  }
  for (const [label, value] of [
    ['fee', input.monthlyFeeHalalas],
    ['operations', input.includedTransactions],
    ['overage', input.overageUnitHalalas],
  ] as const) {
    if (!Number.isInteger(value) || value < (label === 'operations' ? 1 : 0)) {
      throw new NxError('NX-4002', { detail: `the plan ${label} is malformed` });
    }
  }
  if (input.overageUnitHalalas < (await dearestRun(db))) {
    throw new NxError('NX-4002', { detail: 'the overage price is under the cost of a run' });
  }
  try {
    await db.query(
      `INSERT INTO packages (code, name_ar, name_en, billing_model, term_months,
                             platform_fee_halalas, included_transactions, overage_unit_halalas,
                             overage_allowed, sort_order)
       VALUES ($1, $2, $3, 'MONTHLY', 12, $4, $5, $6, true, 50)`,
      [
        code,
        input.nameAr.trim(),
        input.nameEn.trim(),
        input.monthlyFeeHalalas,
        input.includedTransactions,
        input.overageUnitHalalas,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new NxError('NX-4091', { detail: 'a plan with this code exists' });
    }
    throw error;
  }
  await db.query(
    `INSERT INTO package_products (package_code, product_code, enabled)
     SELECT $1, code, true FROM products
     WHERE profile_section IS NOT NULL AND status = 'active'
     ON CONFLICT DO NOTHING`,
    [code],
  );
  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'pricing.plan_added',
    target: `pricing:plan:${code}`,
    metadata: {
      fee: input.monthlyFeeHalalas,
      operations: input.includedTransactions,
      overage: input.overageUnitHalalas,
    },
  });
  return (await listPlans(db)).find((plan) => plan.code === code) as PlanSummary;
}

// ── special prices ───────────────────────────────────────────────────────────────────────

export interface SpecialPrice {
  tenantId: string;
  legalName: string;
  discountPct: number | null;
  products: { productCode: string; nameAr: string; priceHalalas: number }[];
}

export async function listSpecialPrices(db: Queryable): Promise<SpecialPrice[]> {
  const { rows } = await db.query<{
    tenant_id: string;
    legal_name: string;
    discount_pct: string | null;
    product_code: string | null;
    name_ar: string | null;
    unit_price_halalas: number | null;
  }>(
    `SELECT t.id AS tenant_id, t.legal_name, d.discount_pct::text,
            o.product_code, p.name_ar, o.unit_price_halalas
     FROM tenants t
     LEFT JOIN tenant_price_discounts d ON d.tenant_id = t.id
     LEFT JOIN tenant_product_overrides o
       ON o.tenant_id = t.id AND o.unit_price_halalas IS NOT NULL
     LEFT JOIN products p ON p.code = o.product_code
     WHERE t.sandbox_of IS NULL AND (d.tenant_id IS NOT NULL OR o.tenant_id IS NOT NULL)
     ORDER BY t.legal_name, p.check_order`,
  );
  const byTenant = new Map<string, SpecialPrice>();
  for (const row of rows) {
    const entry = byTenant.get(row.tenant_id) ?? {
      tenantId: row.tenant_id,
      legalName: row.legal_name,
      discountPct: row.discount_pct === null ? null : Number(row.discount_pct),
      products: [],
    };
    if (row.product_code !== null && row.unit_price_halalas !== null) {
      entry.products.push({
        productCode: row.product_code,
        nameAr: row.name_ar ?? row.product_code,
        priceHalalas: row.unit_price_halalas,
      });
    }
    byTenant.set(row.tenant_id, entry);
  }
  return [...byTenant.values()];
}

/** A price for one product and one subscriber. Null lifts it and lets the plan decide. */
export async function setSpecialPrice(
  db: Queryable,
  actor: OperatorIdentity,
  input: { tenantId: string; productCode: string; priceHalalas: number | null },
): Promise<void> {
  assertPricing(actor);
  if (input.priceHalalas !== null) {
    const cost = (await costsByProduct(db)).get(input.productCode);
    if (cost === undefined) {
      throw new NxError('NX-4041', { detail: 'no such product' });
    }
    if (!Number.isInteger(input.priceHalalas) || input.priceHalalas < cost) {
      throw new NxError('NX-4002', { detail: 'a special price is never under cost' });
    }
  }
  await db.query(
    `INSERT INTO tenant_product_overrides (tenant_id, product_code, unit_price_halalas)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, product_code) DO UPDATE SET
       unit_price_halalas = EXCLUDED.unit_price_halalas, updated_at = now()`,
    [input.tenantId, input.productCode, input.priceHalalas],
  );
  // A line that no longer says anything is removed rather than left empty.
  await db.query(
    `DELETE FROM tenant_product_overrides
     WHERE tenant_id = $1 AND product_code = $2
       AND enabled IS NULL AND monthly_quota IS NULL AND unit_price_halalas IS NULL`,
    [input.tenantId, input.productCode],
  );
  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'pricing.special_price',
    target: `pricing:tenant:${input.tenantId}`,
    metadata: { product: input.productCode, price: input.priceHalalas },
  });
}

/**
 * A discount on every product for one subscriber. Refused when it would take any check on
 * sale under its cost at the subscriber's price.
 */
export async function setTenantDiscount(
  db: Queryable,
  actor: OperatorIdentity,
  input: { tenantId: string; discountPct: number | null },
): Promise<void> {
  assertPricing(actor);
  if (input.discountPct === null) {
    await db.query(`DELETE FROM tenant_price_discounts WHERE tenant_id = $1`, [input.tenantId]);
  } else {
    if (!(input.discountPct > 0 && input.discountPct < 100)) {
      throw new NxError('NX-4002', { detail: 'a discount is between 0 and 100 percent' });
    }
    const costs = await costsByProduct(db);
    const { rows } = await db.query<{ code: string; price: number | null }>(
      `SELECT p.code,
              COALESCE(
                pp.unit_price_halalas,
                (SELECT round(b.unit_price * 100)::int FROM price_book b
                 WHERE b.product_code = p.code AND b.tenant_id IS NULL AND b.valid_to IS NULL
                 ORDER BY b.valid_from DESC LIMIT 1)
              ) AS price
       FROM products p
       LEFT JOIN tenant_commitments c ON c.tenant_id = $1
       LEFT JOIN package_products pp ON pp.package_code = c.package_code AND pp.product_code = p.code
       LEFT JOIN tenant_product_overrides o ON o.tenant_id = $1 AND o.product_code = p.code
       WHERE p.profile_section IS NOT NULL AND p.status = 'active'
         AND o.unit_price_halalas IS NULL`,
      [input.tenantId],
    );
    const discount = input.discountPct;
    const underCost = rows.filter(
      (row) =>
        row.price !== null &&
        Math.round((row.price * (100 - discount)) / 100) < (costs.get(row.code) ?? 0),
    );
    if (underCost.length > 0) {
      throw new NxError('NX-4002', {
        detail: `the discount takes ${underCost.map((row) => row.code).join(', ')} under cost`,
      });
    }
    await db.query(
      `INSERT INTO tenant_price_discounts (tenant_id, discount_pct, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id) DO UPDATE SET
         discount_pct = EXCLUDED.discount_pct, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [input.tenantId, input.discountPct, actor.id],
    );
  }
  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'pricing.discount',
    target: `pricing:tenant:${input.tenantId}`,
    metadata: { discount_pct: input.discountPct },
  });
}
