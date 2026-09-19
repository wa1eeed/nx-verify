import type { Queryable } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { recordOperatorAudit } from '../operators/audit.js';
import { operatorCan, type OperatorIdentity } from '../operators/accounts.js';
import { halalasToDecimalString } from './money.js';
import { costToUs, vatInForce, withVat } from './vat.js';

/**
 * What the platform sells and for how much (handoff screen 05, «الأسعار والمنتجات»).
 *
 * Four things staff set, on the operator connection, each audited against the person who set
 * it:
 *
 *   the list price of each check    a new versioned row in the price book, never an edit of
 *                                   the old one, and never under what the check costs us
 *                                   (guard 10). Under 30% margin it is allowed and said. The
 *                                   row also carries what an answer that is not a plain
 *                                   success earns, which is set here and nowhere else.
 *   credit bundles                  operations bought once and spent over months. An
 *                                   operation can pay for any check, so its price must cover
 *                                   the dearest call a check makes.
 *   plans                           a monthly fee, the operations it includes, the price of
 *                                   each one past them, and the terms that decide what is
 *                                   charged at signing and what is not charged at all.
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

/**
 * What one run of each product costs us, and from whom.
 *
 * One call per step, at the cost of the provider that will actually serve it (guard 10). Which
 * provider that is comes from the panel's routing first and the step's own provider second,
 * matching the order a real call resolves in: a service routed to a second provider in the
 * panel and still priced at the first one's cost is a margin figure about a call that will not
 * be made.
 *
 * The tax inside a provider's bill is carried separately, because whether it is a cost or
 * reclaimable depends on the day (ADR-157).
 */
interface ProductCost {
  billedHalalas: number;
  vatBps: number;
  /** Who serves it, named, so the screen says it beside the price. Panel only (rule 5). */
  providers: string[];
  /** False when a step has no cost row at all, which a margin must not be computed from. */
  known: boolean;
  /** How many calls one run makes, so a price the steps share can say that it does. */
  steps: number;
}

/**
 * What a run earns when it is not a plain success.
 *
 * These two sit on the price row and decide the actual charge (compute.ts): an authority that
 * answered «no such subject» is billed at `negativePct` of the step's share, and an answer
 * served from cache at `cachePct`. Every price change copied them forward untouched and no
 * screen showed them, so the number that decides what half the runs of a busy month cost was
 * neither readable nor settable by the person whose money it is.
 */
export interface PriceRates {
  /** Fraction of the share a NOT_FOUND answer is charged at, 0 to 1. */
  negativePct: number;
  /** Fraction a CACHED answer is charged at, 0 to 1. */
  cachePct: number;
}

/** What migration 0011 gives a price row that names neither. */
export const DEFAULT_PRICE_RATES: PriceRates = { negativePct: 0.5, cachePct: 1 };

function assertRate(value: number, label: string): void {
  // The column is numeric(4,2) with a 0..1 check, so a third decimal would be rounded into a
  // number nobody typed. Compared with a tolerance rather than exactly, because 0.07 times a
  // hundred is 7.000000000000001 in binary floating point and that is not a reason to refuse
  // seven percent.
  const percent = value * 100;
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1 ||
    Math.abs(percent - Math.round(percent)) > 1e-9
  ) {
    throw new NxError('NX-4002', { detail: `${label} is a share of the price, 0 to 100 percent` });
  }
}

/**
 * The floor a price may not go under (guard 10).
 *
 * The cash we hand the provider, tax included, and not the cost net of reclaimable tax. The
 * conservative number: it is the same figure while the platform is unregistered, and after
 * registration it keeps the floor where it was rather than quietly lowering it by the rate.
 */
function cashCost(cost: ProductCost | undefined): number {
  return cost?.billedHalalas ?? 0;
}

async function costsByProduct(db: Queryable): Promise<Map<string, ProductCost>> {
  const { rows } = await db.query<{
    product_code: string;
    provider: string | null;
    unit_cost: string | null;
    vat_bps: number | null;
  }>(
    `SELECT s.product_code,
            cat.name_ar AS provider,
            c.unit_cost::text AS unit_cost,
            c.vat_bps
     FROM product_steps s
     LEFT JOIN LATERAL (
       SELECT r.provider FROM product_provider_routing r
       WHERE r.product_code = s.product_code AND r.status = 'active'
       ORDER BY r.priority LIMIT 1
     ) routed ON true
     LEFT JOIN LATERAL (
       SELECT unit_cost, vat_bps FROM cost_book
       WHERE provider = COALESCE(routed.provider, s.provider)
         AND endpoint = s.endpoint AND valid_to IS NULL
       ORDER BY valid_from DESC LIMIT 1
     ) c ON true
     LEFT JOIN provider_catalog cat ON cat.code = COALESCE(routed.provider, s.provider)
     ORDER BY s.product_code, s.seq`,
  );

  const costs = new Map<string, ProductCost>();
  for (const row of rows) {
    const entry = costs.get(row.product_code) ?? {
      billedHalalas: 0,
      vatBps: 0,
      providers: [],
      known: true,
      steps: 0,
    };
    entry.steps += 1;
    entry.billedHalalas += Math.round(Number(row.unit_cost ?? 0) * 100);
    // The rate of the dearest step stands for the product: they are the same rate in practice,
    // and a weighted blend of two identical numbers is a calculation nobody can check.
    entry.vatBps = Math.max(entry.vatBps, Number(row.vat_bps ?? 0));
    // Named from the catalogue or not named at all. A connector code is an internal
    // identifier and a screen that prints one has taught somebody to quote it back.
    if (row.provider !== null && !entry.providers.includes(row.provider)) {
      entry.providers.push(row.provider);
    }
    if (row.unit_cost === null) {
      entry.known = false;
    }
    costs.set(row.product_code, entry);
  }
  return costs;
}

export interface ProductPricingRow {
  productCode: string;
  nameAr: string;
  /** What the provider bills us for one run, tax included, in halalas. */
  costHalalas: number;
  /** What that run actually costs us once tax is reclaimable, which depends on the day. */
  effectiveCostHalalas: number;
  /** How much of the bill is tax the provider charged us. */
  costVatBps: number;
  /** False when a step has no cost row, so the margin beside it would be an invention. */
  costKnown: boolean;
  /** Who serves this check today: the panel's routing, or the step's own provider. */
  providers: string[];
  /** The default list price, before VAT. Null when none is in force. */
  priceHalalas: number | null;
  /** What a subscriber pays: the price plus tax, or the price alone while unregistered. */
  priceWithVatHalalas: number | null;
  /** What the open price row charges for a NOT_FOUND and a CACHED answer. Null with no row. */
  rates: PriceRates | null;
  /**
   * Calls one run makes. Above one the price is shared between them by `step_weight`, so the
   * margin below is the margin of a run where every step answered.
   */
  stepCount: number;
  marginPct: number | null;
  /** The riyals kept on one run, which is the figure a margin percentage hides. */
  marginHalalas: number | null;
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
  // Both sides of a margin move on the day the platform registers for tax: what a subscriber
  // pays gains a tax line, and the tax inside a provider's bill stops being a cost. So the
  // margin shown is the margin under today's rule, not under a rule assumed at build time.
  const rule = await vatInForce(db, now);
  const costs = await costsByProduct(db);
  const { rows } = await db.query<{
    code: string;
    name_ar: string;
    status: ProductPricingRow['status'];
    availability: ProductPricingRow['availability'];
    unit_price: string | null;
    negative_pct: string | null;
    cache_pct: string | null;
  }>(
    `SELECT p.code, p.name_ar, p.status, p.availability,
            b.unit_price::text AS unit_price,
            b.negative_pct::text AS negative_pct,
            b.cache_pct::text AS cache_pct
     FROM products p
     LEFT JOIN LATERAL (
       SELECT unit_price, negative_pct, cache_pct FROM price_book
       WHERE product_code = p.code AND tenant_id IS NULL AND contract_id IS NULL
         AND tier_min = 0 AND valid_to IS NULL
       ORDER BY valid_from DESC LIMIT 1
     ) b ON true
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
    const cost = costs.get(row.code) ?? {
      billedHalalas: 0,
      vatBps: 0,
      providers: [],
      known: false,
      steps: 0,
    };
    const effective = costToUs(cost.billedHalalas, cost.vatBps, rule);
    const price = row.unit_price === null ? null : Math.round(Number(row.unit_price) * 100);
    return {
      productCode: row.code,
      nameAr: row.name_ar,
      costHalalas: cost.billedHalalas,
      effectiveCostHalalas: effective,
      costVatBps: cost.vatBps,
      costKnown: cost.known,
      providers: cost.providers,
      priceHalalas: price,
      priceWithVatHalalas: price === null ? null : withVat(price, rule).grossHalalas,
      rates:
        row.negative_pct === null || row.cache_pct === null
          ? null
          : { negativePct: Number(row.negative_pct), cachePct: Number(row.cache_pct) },
      stepCount: cost.steps,
      marginPct: marginOf(price, effective),
      marginHalalas: price === null ? null : price - effective,
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
  /** What the new row charges for the answers that are not a plain success. */
  rates: PriceRates;
}

/**
 * A new list price for a check: a new row in force from now, the old one closed.
 *
 * `rates` names what a NOT_FOUND and a CACHED answer earn. A rate left out keeps the one the
 * open row carries, which is the old behaviour made explicit rather than implied by a COALESCE
 * over a row nobody could see. Changing only a rate still opens a version: the charge changed,
 * and a run billed last week must stay readable at the numbers that billed it.
 */
export async function setListPrice(
  db: Queryable,
  actor: OperatorIdentity,
  productCode: string,
  priceHalalas: number,
  rates: Partial<PriceRates> = {},
): Promise<PriceChange | null> {
  assertPricing(actor);
  if (!Number.isInteger(priceHalalas) || priceHalalas <= 0) {
    throw new NxError('NX-4002', { detail: 'a price is a positive amount' });
  }
  const cost = (await costsByProduct(db)).get(productCode);
  if (cost === undefined) {
    throw new NxError('NX-4041', { detail: 'no such product' });
  }
  if (priceHalalas < cashCost(cost)) {
    throw new NxError('NX-4002', { detail: `the price is under the cost of ${productCode}` });
  }

  const { rows } = await db.query<{
    unit_price: string;
    negative_pct: string;
    cache_pct: string;
  }>(
    `SELECT unit_price::text, negative_pct::text, cache_pct::text FROM price_book
     WHERE product_code = $1 AND tenant_id IS NULL AND contract_id IS NULL AND tier_min = 0
       AND valid_to IS NULL`,
    [productCode],
  );
  const open = rows[0];
  const previous = open === undefined ? null : Math.round(Number(open.unit_price) * 100);
  const current: PriceRates =
    open === undefined
      ? DEFAULT_PRICE_RATES
      : { negativePct: Number(open.negative_pct), cachePct: Number(open.cache_pct) };
  const next: PriceRates = {
    negativePct: rates.negativePct ?? current.negativePct,
    cachePct: rates.cachePct ?? current.cachePct,
  };
  assertRate(next.negativePct, 'the price of a not found answer');
  assertRate(next.cachePct, 'the price of a cached answer');

  if (
    previous === priceHalalas &&
    next.negativePct === current.negativePct &&
    next.cachePct === current.cachePct
  ) {
    return null;
  }

  // One statement, so the old row closes at the very instant the new one opens: no moment in
  // between has no price, and no moment has two.
  await db.query(
    `WITH closed AS (
       UPDATE price_book SET valid_to = now()
       WHERE product_code = $1 AND tenant_id IS NULL AND contract_id IS NULL AND tier_min = 0
         AND valid_to IS NULL
       RETURNING version
     )
     INSERT INTO price_book (product_code, unit_price, negative_pct, cache_pct, version, valid_from)
     VALUES (
       $1, $2::numeric, $3::numeric, $4::numeric,
       COALESCE((SELECT max(version) FROM closed), 0) + 1,
       now()
     )`,
    [productCode, halalasToDecimalString(priceHalalas), next.negativePct, next.cachePct],
  );

  const marginPct = marginOf(priceHalalas, cashCost(cost)) ?? 0;
  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'pricing.list_price',
    target: `pricing:product:${productCode}`,
    metadata: {
      from: previous,
      to: priceHalalas,
      margin_pct: marginPct,
      // Only when they moved: the trail's line says what changed, and a rate that was merely
      // carried forward did not.
      ...(next.negativePct === current.negativePct ? {} : { negative_pct: next.negativePct }),
      ...(next.cachePct === current.cachePct ? {} : { cache_pct: next.cachePct }),
    },
  });
  return {
    productCode,
    priceHalalas,
    marginPct,
    thinMargin: marginPct < MINIMUM_MARGIN_PCT,
    rates: next,
  };
}

/**
 * Takes the list price off a check: the open row is closed and none opens.
 *
 * The screen had no way to do this at all, because the save skipped an empty field, and a
 * product could still sit on sale with no price, where every run fails at `resolvePrice` with
 * NX-4041 and nothing on the screen says why. So a check on sale keeps its price: take it off
 * sale first, which is one click in the same table.
 */
export async function clearListPrice(
  db: Queryable,
  actor: OperatorIdentity,
  productCode: string,
): Promise<boolean> {
  assertPricing(actor);
  const { rows } = await db.query<{ status: string; availability: string }>(
    `SELECT status, availability FROM products WHERE code = $1`,
    [productCode],
  );
  const product = rows[0];
  if (product === undefined) {
    throw new NxError('NX-4041', { detail: 'no such product' });
  }
  if (product.status === 'active' && product.availability === 'AVAILABLE') {
    throw new NxError('NX-4002', { detail: 'a check on sale keeps its price' });
  }
  const { rowCount } = await db.query(
    `UPDATE price_book SET valid_to = now()
     WHERE product_code = $1 AND tenant_id IS NULL AND contract_id IS NULL AND tier_min = 0
       AND valid_to IS NULL`,
    [productCode],
  );
  if ((rowCount ?? 0) === 0) {
    return false;
  }
  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'pricing.price_cleared',
    target: `pricing:product:${productCode}`,
  });
  return true;
}

/** Takes a check off sale for now, or puts it back. A check with no price cannot go back. */
export async function setProductOnSale(
  db: Queryable,
  actor: OperatorIdentity,
  productCode: string,
  onSale: boolean,
): Promise<void> {
  assertPricing(actor);
  if (onSale) {
    // The other half of the rule in clearListPrice. Without it a check with no price at all,
    // which is every new one before somebody prices it, goes on sale and fails on first use.
    const { rows } = await db.query(
      `SELECT 1 FROM price_book
       WHERE product_code = $1 AND tenant_id IS NULL AND contract_id IS NULL AND tier_min = 0
         AND valid_to IS NULL`,
      [productCode],
    );
    if (rows.length === 0) {
      throw new NxError('NX-4002', { detail: 'a check with no price cannot go on sale' });
    }
  }
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
  /**
   * The price of one operation, which is the only figure that makes two bundles comparable
   * and the one the cost floor is measured against. It was computed here and shown nowhere.
   */
  perOperationHalalas: number;
  /**
   * How much cheaper an operation is here than in the smallest bundle on sale, in whole
   * percent. Null for that bundle itself, and for any that is not cheaper. The basis is the
   * smallest bundle and the screen says so: a discount against an unnamed base is a number
   * a buyer cannot check.
   */
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
    // Rounded here rather than after the comparison, so the percent below is measured on the
    // same two figures the screen prints: a discount worked out on the unrounded prices can
    // claim «أقل 1%» beside a price identical to the one it is measured against.
    perOperationHalalas: Math.round(Number(row.price_halalas) / row.operations),
  }));
  // Ordered by operations, so the first bundle on sale is the smallest one: the base every
  // «−8%» on the screen is measured against, and the one the screen names beside it.
  const base = bundles.find((bundle) => bundle.status === 'active')?.perOperationHalalas ?? null;
  return bundles.map((bundle) => {
    const discount =
      base === null || base === 0 ? 0 : Math.round((1 - bundle.perOperationHalalas / base) * 100);
    return { ...bundle, discountPct: discount > 0 ? discount : null };
  });
}

/** The dearest run any check on sale makes: what one operation of a bundle must cover. */
async function dearestRun(db: Queryable): Promise<number> {
  const costs = await costsByProduct(db);
  const { rows } = await db.query<{ code: string }>(
    `SELECT code FROM products
     WHERE profile_section IS NOT NULL AND status = 'active' AND availability = 'AVAILABLE'`,
  );
  return Math.max(0, ...rows.map((row) => cashCost(costs.get(row.code))));
}

export interface BundleInput {
  operations: number;
  priceHalalas: number;
  validityMonths?: number;
  /**
   * The bundle this deliberately replaces, by code.
   *
   * A bundle is named after the number of operations it holds, so «إضافة» with a count that
   * already exists used to overwrite that bundle's price and term, and put a retired one back
   * on sale, while the dialog said «إضافة» and the notice said «حُفظت». Replacing is a real
   * act, so it is asked for by name.
   */
  replaces?: string;
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

  const { rows: existing } = await db.query<{ price_halalas: string; status: string }>(
    `SELECT price_halalas::text, status FROM credit_bundles WHERE code = $1`,
    [code],
  );
  const current = existing[0];
  if (current !== undefined && input.replaces !== code) {
    throw new NxError('NX-4091', {
      detail: `a bundle of ${input.operations} operations is already defined`,
    });
  }
  if (current === undefined && input.replaces !== undefined) {
    throw new NxError('NX-4041', { detail: 'the bundle to replace no longer exists' });
  }

  // The refusal above is carried into the write itself rather than trusted from the read a
  // moment earlier: the update runs only for a replacement that named this code, so two
  // operators adding the same count at once end with one addition and one refusal, not a
  // price quietly overwritten between the SELECT and the INSERT.
  const { rowCount } = await db.query(
    `INSERT INTO credit_bundles (code, operations, price_halalas, validity_months, sort_order, updated_by)
     VALUES ($1, $2, $3, $4, $2, $5)
     ON CONFLICT (code) DO UPDATE SET
       price_halalas = EXCLUDED.price_halalas, validity_months = EXCLUDED.validity_months,
       status = 'active', updated_at = now(), updated_by = EXCLUDED.updated_by
     WHERE $6::boolean`,
    [code, input.operations, input.priceHalalas, validity, actor.id, input.replaces === code],
  );
  if ((rowCount ?? 0) === 0) {
    throw new NxError('NX-4091', {
      detail: `a bundle of ${input.operations} operations is already defined`,
    });
  }
  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: current === undefined ? 'pricing.bundle_added' : 'pricing.bundle_replaced',
    target: `pricing:bundle:${code}`,
    metadata: {
      operations: input.operations,
      price: input.priceHalalas,
      months: validity,
      ...(current === undefined ? {} : { from: Number(current.price_halalas) }),
      // A bundle that was off sale is on sale again, which is a decision of its own and is
      // read back from the trail rather than guessed from two rows far apart.
      ...(current?.status === 'retired' ? { resumed: true } : {}),
    },
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

/**
 * The commercial terms of a plan that are not its price per run.
 *
 * All five were written by `addPlan` as literals and shown on no screen, and one of them
 * prices work at zero: inside `freeReverifyDays` a re-check of the same entity is charged
 * nothing at all (verify.ts). A whole class of free work, invisible to the person whose
 * margin pays for it.
 */
export interface PlanTerms {
  /** The length of the commitment. The schema allows 3, 12 and 24 months only. */
  termMonths: number;
  /** Re-verifying the same entity inside this many days costs the subscriber nothing. */
  freeReverifyDays: number;
  /** Charged once at signing, and waived by `setup_waived_from_months` on a long term. */
  setupFeeHalalas: number;
  /** Credit the term grants at signing. */
  commitmentCreditsHalalas: number;
  /** Whether a run may happen at all once the included operations are spent. */
  overageAllowed: boolean;
}

export interface PlanSummary extends PlanTerms {
  code: string;
  nameAr: string;
  billingModel: string;
  /** Per month, before VAT. Zero for a plan priced by negotiation. */
  monthlyFeeHalalas: number;
  /** The fee as the row holds it: a year's fee on an annual plan, a month's on a monthly one. */
  platformFeeHalalas: number;
  includedTransactions: number | null;
  overageUnitHalalas: number | null;
  /** No fee and no fixed operations: the terms are agreed per subscriber. */
  negotiated: boolean;
}

interface PlanRow {
  code: string;
  name_ar: string;
  billing_model: string;
  platform_fee_halalas: number;
  included_transactions: number | null;
  overage_unit_halalas: number | null;
  term_months: number;
  free_reverify_days: number;
  setup_fee_halalas: number;
  commitment_credits_halalas: number;
  overage_allowed: boolean;
}

const PLAN_COLUMNS = `code, name_ar, billing_model, platform_fee_halalas, included_transactions,
            overage_unit_halalas, term_months, free_reverify_days, setup_fee_halalas,
            commitment_credits_halalas, overage_allowed`;

function planOf(row: PlanRow): PlanSummary {
  return {
    code: row.code,
    nameAr: row.name_ar,
    billingModel: row.billing_model,
    monthlyFeeHalalas:
      row.billing_model === 'ANNUAL'
        ? Math.round(row.platform_fee_halalas / 12)
        : row.platform_fee_halalas,
    platformFeeHalalas: row.platform_fee_halalas,
    includedTransactions: row.included_transactions,
    overageUnitHalalas: row.overage_unit_halalas,
    negotiated: row.platform_fee_halalas === 0 && row.included_transactions === null,
    termMonths: row.term_months,
    freeReverifyDays: row.free_reverify_days,
    setupFeeHalalas: row.setup_fee_halalas,
    commitmentCreditsHalalas: row.commitment_credits_halalas,
    overageAllowed: row.overage_allowed,
  };
}

export async function listPlans(db: Queryable): Promise<PlanSummary[]> {
  const { rows } = await db.query<PlanRow>(
    `SELECT ${PLAN_COLUMNS}
     FROM packages
     WHERE status = 'active' AND code <> 'SANDBOX'
     ORDER BY sort_order, code`,
  );
  return rows.map(planOf);
}

export interface PlanInput extends Partial<PlanTerms> {
  code: string;
  nameAr: string;
  nameEn: string;
  monthlyFeeHalalas: number;
  includedTransactions: number;
  overageUnitHalalas: number;
}

/** What a plan falls back to when the person adding it names nothing: the schema's own row. */
export const DEFAULT_PLAN_TERMS: PlanTerms = {
  termMonths: 12,
  freeReverifyDays: 30,
  setupFeeHalalas: 0,
  commitmentCreditsHalalas: 0,
  overageAllowed: true,
};

const TERM_MONTHS = [3, 12, 24];

function assertTerms(terms: PlanTerms): void {
  if (!TERM_MONTHS.includes(terms.termMonths)) {
    throw new NxError('NX-4002', { detail: 'a commitment runs 3, 12 or 24 months' });
  }
  if (
    !Number.isInteger(terms.freeReverifyDays) ||
    terms.freeReverifyDays < 0 ||
    terms.freeReverifyDays > 365
  ) {
    throw new NxError('NX-4002', { detail: 'the free re-verification window is 0 to 365 days' });
  }
  for (const [label, value] of [
    ['setup fee', terms.setupFeeHalalas],
    ['commitment credit', terms.commitmentCreditsHalalas],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new NxError('NX-4002', { detail: `the plan ${label} is malformed` });
    }
  }
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
  const terms: PlanTerms = {
    termMonths: input.termMonths ?? DEFAULT_PLAN_TERMS.termMonths,
    freeReverifyDays: input.freeReverifyDays ?? DEFAULT_PLAN_TERMS.freeReverifyDays,
    setupFeeHalalas: input.setupFeeHalalas ?? DEFAULT_PLAN_TERMS.setupFeeHalalas,
    commitmentCreditsHalalas:
      input.commitmentCreditsHalalas ?? DEFAULT_PLAN_TERMS.commitmentCreditsHalalas,
    overageAllowed: input.overageAllowed ?? DEFAULT_PLAN_TERMS.overageAllowed,
  };
  assertTerms(terms);
  if (input.overageUnitHalalas < (await dearestRun(db))) {
    throw new NxError('NX-4002', { detail: 'the overage price is under the cost of a run' });
  }
  try {
    await db.query(
      `INSERT INTO packages (code, name_ar, name_en, billing_model, term_months,
                             platform_fee_halalas, included_transactions, overage_unit_halalas,
                             overage_allowed, free_reverify_days, setup_fee_halalas,
                             commitment_credits_halalas, sort_order)
       VALUES ($1, $2, $3, 'MONTHLY', $7, $4, $5, $6, $8, $9, $10, $11, 50)`,
      [
        code,
        input.nameAr.trim(),
        input.nameEn.trim(),
        input.monthlyFeeHalalas,
        input.includedTransactions,
        input.overageUnitHalalas,
        terms.termMonths,
        terms.overageAllowed,
        terms.freeReverifyDays,
        terms.setupFeeHalalas,
        terms.commitmentCreditsHalalas,
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
      free_reverify_days: terms.freeReverifyDays,
      term_months: terms.termMonths,
      setup_fee: terms.setupFeeHalalas,
    },
  });
  return (await listPlans(db)).find((plan) => plan.code === code) as PlanSummary;
}

/**
 * The terms of a plan already on sale.
 *
 * A patch: a field the caller does not name keeps its value (ADR-164). Two of these reach
 * subscribers who signed months ago, because the commitment reads them live from the plan:
 * the free re-verification window and whether overage is allowed at all. The price of an
 * overage does not, having been stamped at signing (ADR-168), so editing it here prices
 * tomorrow's commitments only.
 */
export interface PlanTermsInput extends Partial<PlanTerms> {
  monthlyFeeHalalas?: number;
  includedTransactions?: number | null;
  overageUnitHalalas?: number | null;
}

export async function setPlanTerms(
  db: Queryable,
  actor: OperatorIdentity,
  code: string,
  input: PlanTermsInput,
): Promise<PlanSummary> {
  assertPricing(actor);
  const { rows } = await db.query<PlanRow>(
    `SELECT ${PLAN_COLUMNS} FROM packages WHERE code = $1 AND status = 'active'`,
    [code],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new NxError('NX-4041', { detail: 'no such active plan' });
  }
  const before = planOf(row);

  const terms: PlanTerms = {
    termMonths: input.termMonths ?? before.termMonths,
    freeReverifyDays: input.freeReverifyDays ?? before.freeReverifyDays,
    setupFeeHalalas: input.setupFeeHalalas ?? before.setupFeeHalalas,
    commitmentCreditsHalalas: input.commitmentCreditsHalalas ?? before.commitmentCreditsHalalas,
    overageAllowed: input.overageAllowed ?? before.overageAllowed,
  };
  assertTerms(terms);

  // The fee is written as the row holds it, not as the card shows it: an annual plan's card
  // shows a twelfth, and writing that back would divide the plan's price by twelve.
  const fee = input.monthlyFeeHalalas ?? before.platformFeeHalalas;
  if (!Number.isInteger(fee) || fee < 0) {
    throw new NxError('NX-4002', { detail: 'the plan fee is malformed' });
  }
  const included =
    input.includedTransactions === undefined
      ? before.includedTransactions
      : input.includedTransactions;
  if (included !== null && (!Number.isInteger(included) || included < 1)) {
    throw new NxError('NX-4002', { detail: 'the plan operations are malformed' });
  }
  const overage =
    input.overageUnitHalalas === undefined ? before.overageUnitHalalas : input.overageUnitHalalas;
  if (overage !== null) {
    if (!Number.isInteger(overage) || overage < 0) {
      throw new NxError('NX-4002', { detail: 'the plan overage is malformed' });
    }
    // Guard 10 for the price a subscriber actually pays past the capacity they bought.
    if (terms.overageAllowed && overage < (await dearestRun(db))) {
      throw new NxError('NX-4002', { detail: 'the overage price is under the cost of a run' });
    }
  }

  await db.query(
    `UPDATE packages
        SET platform_fee_halalas = $2, included_transactions = $3, overage_unit_halalas = $4,
            term_months = $5, free_reverify_days = $6, setup_fee_halalas = $7,
            commitment_credits_halalas = $8, overage_allowed = $9, updated_at = now()
      WHERE code = $1`,
    [
      code,
      fee,
      included,
      overage,
      terms.termMonths,
      terms.freeReverifyDays,
      terms.setupFeeHalalas,
      terms.commitmentCreditsHalalas,
      terms.overageAllowed,
    ],
  );

  const after: PlanSummary = planOf({
    ...row,
    platform_fee_halalas: fee,
    included_transactions: included,
    overage_unit_halalas: overage,
    term_months: terms.termMonths,
    free_reverify_days: terms.freeReverifyDays,
    setup_fee_halalas: terms.setupFeeHalalas,
    commitment_credits_halalas: terms.commitmentCreditsHalalas,
    overage_allowed: terms.overageAllowed,
  });
  const changed: Record<string, unknown> = {};
  for (const [key, was, now] of [
    ['fee', before.platformFeeHalalas, after.platformFeeHalalas],
    ['operations', before.includedTransactions, after.includedTransactions],
    ['overage', before.overageUnitHalalas, after.overageUnitHalalas],
    ['term_months', before.termMonths, after.termMonths],
    ['free_reverify_days', before.freeReverifyDays, after.freeReverifyDays],
    ['setup_fee', before.setupFeeHalalas, after.setupFeeHalalas],
    ['commitment_credits', before.commitmentCreditsHalalas, after.commitmentCreditsHalalas],
    ['overage_allowed', before.overageAllowed, after.overageAllowed],
  ] as const) {
    if (was !== now) {
      changed[key] = now;
    }
  }
  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'pricing.plan_terms',
    target: `pricing:plan:${code}`,
    metadata: changed,
  });
  return after;
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
    if (!Number.isInteger(input.priceHalalas) || input.priceHalalas < cashCost(cost)) {
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
        Math.round((row.price * (100 - discount)) / 100) < cashCost(costs.get(row.code)),
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
