import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';

/**
 * May this subscriber run this product right now.
 *
 * Three layers, narrowest first: an override written for this one subscriber, then the
 * package they are on, then the catalogue. The first layer that mentions the product
 * decides, which is what lets a negotiated exception exist without becoming a new package,
 * and a catalogue of three plans stay a catalogue of three plans.
 *
 * The answer is computed here rather than in the API, because there are five ways to start
 * a verification: the API, the console, a batch, a monitor and the MCP server. A check in
 * a route protects one of them. See ADR-061.
 */

export type EntitlementRefusal =
  | 'NO_SUBSCRIPTION'
  | 'SUBSCRIPTION_INACTIVE'
  | 'PRODUCT_NOT_IN_PACKAGE'
  | 'PRODUCT_DISABLED'
  | 'MODULE_OFF'
  | 'QUOTA_EXHAUSTED'
  | 'CAPACITY_EXHAUSTED';

export interface Entitlement {
  productCode: string;
  allowed: boolean;
  refusal: EntitlementRefusal | null;
  packageCode: string | null;
  /** Runs allowed this cycle. Null means the credits are the only limit. */
  quota: number | null;
  used: number;
  remaining: number | null;
  /** Where the price comes from when the package or an override sets one. */
  unitPriceHalalas: number | null;
  /**
   * The plan's flat rate for a transaction past the committed capacity, when this run is
   * past it and the plan allows overage. Null when it does not apply: inside the capacity,
   * no overage rate on the plan, overage not allowed, or a price written for this
   * subscriber outranks it.
   */
  overageUnitPriceHalalas: number | null;
  /**
   * The same rate, read without asking where this run falls: what a run past the capacity
   * would be charged whether or not the capacity is spent yet. Null when it can never apply.
   *
   * It exists beside the field above because a screen quoting a whole selection needs both.
   * Ten ticked operations with three left in the capacity are charged at two prices, and the
   * one the entitlement names today is the cheaper of them (ADR-188).
   */
  overageRateHalalas: number | null;
  /** True when this product is on because somebody wrote a line for this subscriber. */
  negotiated: boolean;
  /** Transactions left in the term's capacity. Null when the plan sells no capacity. */
  capacityRemaining: number | null;
  /**
   * A discount on every product agreed for this subscriber, in percent. It applies where no
   * price was written for the product itself.
   */
  discountPct: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
}

interface EntitlementRow {
  product_code: string;
  package_code: string | null;
  subscription_status: string | null;
  period_start: Date | null;
  period_end: Date | null;
  package_enabled: boolean | null;
  package_quota: number | null;
  package_price: number | null;
  override_enabled: boolean | null;
  override_quota: number | null;
  override_price: number | null;
  module_code: string;
  module_core: boolean;
  module_status: string;
  /** What staff decided about this module for this subscriber. Null when nobody has. */
  module_enabled: boolean | null;
  used: number | null;
  included_transactions: number | null;
  transactions_used: number | null;
  overage_allowed: boolean | null;
  /** The plan's flat price for a transaction past the capacity. Null when it names none. */
  overage_price: number | null;
  discount_pct: string | null;
}

/**
 * One query, because entitlement is read before every run and a run must not cost five
 * round trips before it starts.
 */
const ENTITLEMENT_SQL = `
  SELECT p.code AS product_code,
         s.package_code,
         s.status AS subscription_status,
         s.term_start AS period_start,
         s.term_end AS period_end,
         pp.enabled AS package_enabled,
         pp.monthly_quota AS package_quota,
         pp.unit_price_halalas AS package_price,
         o.enabled AS override_enabled,
         o.monthly_quota AS override_quota,
         o.unit_price_halalas AS override_price,
         u.used,
         s.included_transactions,
         s.transactions_used,
         pk.overage_allowed,
         -- The rate this customer signed for, not the rate the plan carries today. Migration
         -- 0026 put the capacity on the commitment for exactly this reason and 0065 finished
         -- the job: editing a plan must not reprice runs already taken (ADR-168).
         COALESCE(s.overage_unit_halalas, pk.overage_unit_halalas) AS overage_price,
         d.discount_pct::text AS discount_pct,
         p.module_code,
         m.core AS module_core,
         m.status AS module_status,
         tm.enabled AS module_enabled
  FROM products p
  JOIN modules m ON m.code = p.module_code
  LEFT JOIN tenant_modules tm ON tm.tenant_id = $1 AND tm.module_code = p.module_code
  LEFT JOIN tenant_price_discounts d ON d.tenant_id = $1
  LEFT JOIN tenant_commitments s ON s.tenant_id = $1
  LEFT JOIN packages pk ON pk.code = s.package_code
  LEFT JOIN package_products pp
    ON pp.package_code = s.package_code AND pp.product_code = p.code
  LEFT JOIN tenant_product_overrides o
    ON o.tenant_id = $1 AND o.product_code = p.code
  LEFT JOIN product_usage u
    ON u.tenant_id = $1 AND u.product_code = p.code
   AND u.period_start = date_trunc('month', now())::date
  WHERE p.status = 'active' AND ($2::text IS NULL OR p.code = $2)
  ORDER BY p.code
`;

function decide(row: EntitlementRow): Entitlement {
  const used = row.used ?? 0;
  const negotiated =
    row.override_enabled !== null ||
    row.override_quota !== null ||
    row.override_price !== null ||
    // A module switched for this subscriber alone is a line written for them just as much as
    // a price is, and the panel counts it the same way.
    row.module_enabled !== null;

  const capacity = row.included_transactions;
  const capacityUsed = row.transactions_used ?? 0;
  const capacityRemaining = capacity === null ? null : Math.max(0, capacity - capacityUsed);

  /**
   * Past what the term bought, with the plan willing to carry on.
   *
   * The same comparison verify.ts makes when it decides the package no longer pays for a
   * run, and made from the same two numbers, so the price and the payer cannot disagree
   * about which side of the capacity a run falls on.
   */
  const pastCapacity =
    capacity !== null && capacityUsed >= capacity && row.overage_allowed === true;

  /**
   * The rate that waits on the other side of the capacity, read without asking whether this
   * run is there yet. Everything that decides whether it can ever apply to this subscriber is
   * here; the only thing left to `overageUnitPriceHalalas` is where this one run falls.
   */
  const overageRate =
    row.overage_allowed === true && row.override_price === null ? row.overage_price : null;

  const base: Omit<Entitlement, 'allowed' | 'refusal' | 'remaining'> = {
    capacityRemaining,
    discountPct:
      row.override_price === null && row.discount_pct !== null ? Number(row.discount_pct) : null,
    productCode: row.product_code,
    packageCode: row.package_code,
    quota: row.override_quota ?? row.package_quota,
    used,
    unitPriceHalalas: row.override_price ?? row.package_price,
    /*
     * Which of the plan's two prices an excess run gets.
     *
     * A plan states two figures: what an included transaction costs, and what one past the
     * capacity costs. The second was collected in the operator panel, validated there
     * against the cost of the dearest run in the catalogue, and printed on the plan card,
     * and then no charging path ever read it. Every excess run was billed at the included
     * rate, so the number the owner typed existed on a screen and nowhere else.
     *
     * Past the capacity the plan's overage rate outranks the plan's own per product price.
     * Both are plan wide, so neither is nearer this subscriber; what separates them is that
     * the per product price is the rate a commitment bought, and the commitment is spent.
     * The overage rate is the plan's answer to the one question that only arises here,
     * which makes it the narrower rule for this run. Decided the other way, a plan that
     * prices its products individually could never charge overage at all and its capacity
     * would be a number with no consequence.
     *
     * A price written for this subscriber and this product still outranks it, which is why
     * it is dropped when there is one: that line was negotiated with this plan in view. No
     * such exception exists for the tenant wide discount, which keeps applying, because the
     * overage rate is a plan figure and the discount is what this subscriber pays off any
     * figure that was not written for them.
     */
    overageUnitPriceHalalas: pastCapacity ? overageRate : null,
    overageRateHalalas: overageRate,
    negotiated,
    periodStart: row.period_start,
    periodEnd: row.period_end,
  };

  const refuse = (refusal: EntitlementRefusal): Entitlement => ({
    ...base,
    allowed: false,
    refusal,
    remaining: base.quota === null ? null : Math.max(0, base.quota - used),
  });

  // An override that says yes turns a product on even when the package does not carry it,
  // and an override that says no turns it off even when the package does.
  if (row.override_enabled === false) {
    return refuse('PRODUCT_DISABLED');
  }

  // The module, which is the unit a subscriber is actually sold (ADR-137). Off for them means
  // off everywhere at once: the customer file, the request screen and the API, rather than a
  // section leaving a screen while the endpoint keeps answering. A core module is not on the
  // switch, because the file cannot be drawn without it.
  const moduleOff =
    !row.module_core && (row.module_status === 'retired' || row.module_enabled === false);
  if (moduleOff && row.override_enabled !== true) {
    return refuse('MODULE_OFF');
  }
  // Switching the module on for one subscriber is the same kind of act as writing an
  // exception for one product, and it opens the same door: their plan need not carry it.
  const openedForThem =
    row.override_enabled === true || (!row.module_core && row.module_enabled === true);

  if (!openedForThem) {
    if (!row.package_code) {
      return refuse('NO_SUBSCRIPTION');
    }
    if (row.subscription_status !== 'active' && row.subscription_status !== 'trial') {
      return refuse('SUBSCRIPTION_INACTIVE');
    }
    if (row.package_enabled === null) {
      return refuse('PRODUCT_NOT_IN_PACKAGE');
    }
    if (row.package_enabled === false) {
      return refuse('PRODUCT_DISABLED');
    }
  }

  if (base.quota !== null && used >= base.quota) {
    return refuse('QUOTA_EXHAUSTED');
  }

  // The term's capacity, which is what a quotation actually sells. A plan that allows
  // overage keeps working past it and bills the excess; one that does not, stops.
  if (capacity !== null && capacityUsed >= capacity && row.overage_allowed !== true) {
    return refuse('CAPACITY_EXHAUSTED');
  }

  return {
    ...base,
    allowed: true,
    refusal: null,
    remaining: base.quota === null ? null : Math.max(0, base.quota - used),
  };
}

/**
 * The price a run is charged at, before VAT: a price written for this subscriber or plan, or
 * the list price, less any discount agreed on every product.
 *
 * Once the committed capacity is spent the plan's overage rate stands in front of the plan's
 * per product price. Which layer wins is settled in decide(), beside every other layering of
 * these tables, so there is one place to read the order rather than two that can drift.
 */
export function chargedUnitPrice(entitlement: Entitlement, listPriceHalalas: number): number {
  const price =
    entitlement.overageUnitPriceHalalas ?? entitlement.unitPriceHalalas ?? listPriceHalalas;
  return entitlement.discountPct === null
    ? price
    : Math.round((price * (100 - entitlement.discountPct)) / 100);
}

/**
 * The most one run of this product can be charged before the term's capacity is refilled.
 *
 * The same function a run is priced by, asked twice: once about this subscriber as they stand
 * now, and once about them the moment the capacity runs out. The dearer answer wins.
 *
 * A screen that quotes a whole selection needs this and not `chargedUnitPrice`, because a
 * selection is charged on both sides of the capacity at once: with three transactions left and
 * ten ticked, the first three are included and the other seven are overage. Summing the
 * included rate for all ten told the subscriber a smaller number than the wallet was about to
 * hold, which is the one direction a figure printed before a button may never be wrong in
 * (ADR-188). Where the two rates cannot differ this returns exactly what the run is charged,
 * so nothing is inflated to be safe.
 */
export function ceilingUnitPrice(entitlement: Entitlement, listPriceHalalas: number): number {
  const now = chargedUnitPrice(entitlement, listPriceHalalas);
  if (entitlement.overageRateHalalas === null) {
    return now;
  }
  const spent = chargedUnitPrice(
    { ...entitlement, overageUnitPriceHalalas: entitlement.overageRateHalalas },
    listPriceHalalas,
  );
  // Not always the overage rate: a plan may price an excess run below its included one, and
  // the ceiling of a selection that straddles the capacity is then the included rate.
  return Math.max(now, spent);
}

export async function resolveEntitlement(
  tx: TenantTransaction,
  productCode: string,
): Promise<Entitlement> {
  const { rows } = await tx.query<EntitlementRow>(ENTITLEMENT_SQL, [tx.tenantId, productCode]);
  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', { detail: 'no such product' });
  }
  return decide(row);
}

/** Every product in the catalogue, with the subscriber's standing on each. */
export async function listEntitlements(tx: TenantTransaction): Promise<Entitlement[]> {
  const { rows } = await tx.query<EntitlementRow>(ENTITLEMENT_SQL, [tx.tenantId, null]);
  return rows.map(decide);
}

const REFUSAL_MESSAGES: Record<EntitlementRefusal, { ar: string; en: string }> = {
  NO_SUBSCRIPTION: {
    ar: 'لا توجد باقة مفعّلة لمساحة العمل هذه.',
    en: 'This workspace has no active package.',
  },
  SUBSCRIPTION_INACTIVE: {
    ar: 'اشتراك مساحة العمل غير نشط.',
    en: 'The workspace subscription is not active.',
  },
  PRODUCT_NOT_IN_PACKAGE: {
    ar: 'وحدة التحقق هذه غير مشمولة في باقتك.',
    en: 'This verification module is not included in your package.',
  },
  PRODUCT_DISABLED: {
    ar: 'وحدة التحقق هذه معطّلة لمساحة عملك.',
    en: 'This verification module is disabled for your workspace.',
  },
  MODULE_OFF: {
    ar: 'هذه الخدمة ضمن موديول غير مفعّل لمساحة عملك.',
    en: 'This service belongs to a module that is not enabled for your workspace.',
  },
  QUOTA_EXHAUSTED: {
    ar: 'استُنفدت حصة هذه الوحدة لهذه الدورة.',
    en: 'The quota for this module is exhausted for this cycle.',
  },
  CAPACITY_EXHAUSTED: {
    ar: 'استُنفدت سعة الالتزام لهذه المدة، ولا تسمح الباقة بتجاوزها.',
    en: 'The committed capacity for this term is used up and this plan does not allow overage.',
  },
};

/**
 * Refuses before anything is spent.
 *
 * The message says which package rule stopped the call and never why in provider terms,
 * because a subscriber who is told "module not included" can act on it and a subscriber
 * told "upstream unavailable" opens a support ticket.
 */
export function assertEntitled(entitlement: Entitlement): void {
  if (entitlement.allowed) {
    return;
  }
  const refusal = entitlement.refusal ?? 'PRODUCT_NOT_IN_PACKAGE';
  const message = REFUSAL_MESSAGES[refusal];
  throw new NxError('NX-4031', {
    detail: `${message.en} (${refusal})`,
    cause: message.ar,
  });
}

/**
 * Counts a run against the cycle.
 *
 * Called after a run is committed rather than before it starts, so a request that never
 * reached a provider never eats a quota. A replay does not count either: rule 7 says the
 * same key is the same result and one charge, and a quota is a charge in another currency.
 */
export async function recordUsage(tx: TenantTransaction, productCode: string): Promise<void> {
  // Two counters, because they answer two questions: the monthly one answers whether a
  // module's quota is spent, and the term one answers what the customer committed to.
  await tx.query(
    `UPDATE tenant_commitments SET transactions_used = transactions_used + 1, updated_at = now()
     WHERE tenant_id = $1`,
    [tx.tenantId],
  );

  await tx.query(
    `INSERT INTO product_usage (tenant_id, period_start, product_code, used)
     VALUES ($1, date_trunc('month', now())::date, $2, 1)
     ON CONFLICT (tenant_id, period_start, product_code)
     DO UPDATE SET used = product_usage.used + 1, updated_at = now()`,
    [tx.tenantId, productCode],
  );
}

/**
 * What a subscriber committed to.
 *
 * Not a subscription, and the name matters: docs/01-blueprint.md section 9 opens by
 * saying so. An annual commitment grants credit at full value, the platform carries no
 * fee of its own, overage is billed at the same unit prices, and what is unused carries
 * for ninety days. The figures a term granted are read from the commitment row and not
 * from the plan, because a plan edited next year must not change what a customer was
 * given this year.
 */
export interface Commitment {
  packageCode: string;
  packageNameAr: string;
  status: string;
  termMonths: number;
  billingModel: string;
  creditsGrantedHalalas: number;
  /** Transactions this term may run. Null when the plan sells credit rather than count. */
  includedTransactions: number | null;
  transactionsUsed: number;
  overageUnitHalalas: number | null;
  platformFeeHalalas: number;
  setupFeeHalalas: number;
  creditRolloverDays: number;
  overageAllowed: boolean;
  /** Seats included before an extra one is charged, and what an extra one costs. */
  includedSeats: number;
  extraSeatHalalas: number;
  includedPortfolios: number;
  extraPortfolioHalalas: number;
  /** Re-verifying the same entity within this many days is free. */
  freeReverifyDays: number;
  maxUsers: number | null;
  maxApiKeys: number | null;
  maxMonitors: number | null;
  rateLimitRpm: number;
  supportTier: string;
  termStart: Date;
  termEnd: Date;
  trialEndsAt: Date | null;
  contractRef: string | null;
}

export async function getCommitment(tx: TenantTransaction): Promise<Commitment | null> {
  const { rows } = await tx.query<{
    package_code: string;
    name_ar: string;
    status: string;
    term_months: number;
    credits_granted_halalas: number;
    setup_fee_halalas: number;
    credit_rollover_days: number;
    overage_allowed: boolean;
    included_seats: number;
    extra_seat_halalas: number;
    included_portfolios: number;
    extra_portfolio_halalas: number;
    free_reverify_days: number;
    max_users: number | null;
    max_api_keys: number | null;
    max_monitors: number | null;
    rate_limit_rpm: number;
    support_tier: string;
    term_start: Date;
    term_end: Date;
    trial_ends_at: Date | null;
    contract_ref: string | null;
    billing_model: string;
    included_transactions: number | null;
    transactions_used: number;
    overage_unit_halalas: number | null;
    platform_fee_halalas: number;
  }>(
    `SELECT s.package_code, p.name_ar, s.status, s.term_months,
            s.credits_granted_halalas, s.setup_fee_halalas, p.credit_rollover_days,
            p.overage_allowed, p.included_seats, p.extra_seat_halalas,
            p.included_portfolios, p.extra_portfolio_halalas, p.free_reverify_days,
            p.max_users, p.max_api_keys, p.max_monitors, p.rate_limit_rpm, p.support_tier,
                    s.term_start, s.term_end, s.trial_ends_at, s.contract_ref,
            p.billing_model, s.included_transactions, s.transactions_used,
            p.overage_unit_halalas, s.platform_fee_halalas
     FROM tenant_commitments s
     JOIN packages p ON p.code = s.package_code
     WHERE s.tenant_id = $1`,
    [tx.tenantId],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    packageCode: row.package_code,
    packageNameAr: row.name_ar,
    status: row.status,
    termMonths: row.term_months,
    billingModel: row.billing_model,
    creditsGrantedHalalas: row.credits_granted_halalas,
    includedTransactions: row.included_transactions,
    transactionsUsed: row.transactions_used,
    overageUnitHalalas: row.overage_unit_halalas,
    platformFeeHalalas: row.platform_fee_halalas,
    setupFeeHalalas: row.setup_fee_halalas,
    creditRolloverDays: row.credit_rollover_days,
    overageAllowed: row.overage_allowed,
    includedSeats: row.included_seats,
    extraSeatHalalas: row.extra_seat_halalas,
    includedPortfolios: row.included_portfolios,
    extraPortfolioHalalas: row.extra_portfolio_halalas,
    freeReverifyDays: row.free_reverify_days,
    maxUsers: row.max_users,
    maxApiKeys: row.max_api_keys,
    maxMonitors: row.max_monitors,
    rateLimitRpm: row.rate_limit_rpm,
    supportTier: row.support_tier,
    termStart: row.term_start,
    termEnd: row.term_end,
    trialEndsAt: row.trial_ends_at,
    contractRef: row.contract_ref,
  };
}

/**
 * What the term is costing beyond the credit, so an invoice can be explained.
 *
 * Seats and active portfolios are the two components that grow without consumption
 * growing, which is what separates this from a query gateway. Both are counted, both are
 * charged only above what the plan includes, and the numbers are aggregates rather than
 * a walk over anybody's data.
 */
export interface TermExtras {
  seats: number;
  chargeableSeats: number;
  seatChargeHalalas: number;
  portfolios: number;
  chargeablePortfolios: number;
  portfolioChargeHalalas: number;
  setupFeeHalalas: number;
  platformFeeHalalas: number;
  totalHalalas: number;
}

export async function computeTermExtras(tx: TenantTransaction): Promise<TermExtras | null> {
  const commitment = await getCommitment(tx);
  if (!commitment) {
    return null;
  }

  const { rows } = await tx.query<{ seats: string; portfolios: string }>(
    `SELECT
       (SELECT count(*) FROM users WHERE tenant_id = $1 AND status = 'active') AS seats,
       (SELECT count(*) FROM portfolios WHERE tenant_id = $1) AS portfolios`,
    [tx.tenantId],
  );

  const seats = Number(rows[0]?.seats ?? 0);
  const portfolios = Number(rows[0]?.portfolios ?? 0);
  const chargeableSeats = Math.max(0, seats - commitment.includedSeats);
  const chargeablePortfolios = Math.max(0, portfolios - commitment.includedPortfolios);
  const seatCharge = chargeableSeats * commitment.extraSeatHalalas;
  const portfolioCharge = chargeablePortfolios * commitment.extraPortfolioHalalas;

  return {
    seats,
    chargeableSeats,
    seatChargeHalalas: seatCharge,
    portfolios,
    chargeablePortfolios,
    portfolioChargeHalalas: portfolioCharge,
    setupFeeHalalas: commitment.setupFeeHalalas,
    platformFeeHalalas: commitment.platformFeeHalalas,
    totalHalalas:
      seatCharge + portfolioCharge + commitment.setupFeeHalalas + commitment.platformFeeHalalas,
  };
}

/**
 * The setup fee this term actually attracts.
 *
 * Waived at the term the plan names, which is the promise in the offer and therefore a
 * rule rather than a discount somebody remembers to apply.
 */
export function setupFeeFor(
  plan: { setupFeeHalalas: number; setupWaivedFromMonths: number | null },
  termMonths: number,
): number {
  if (plan.setupWaivedFromMonths !== null && termMonths >= plan.setupWaivedFromMonths) {
    return 0;
  }
  return plan.setupFeeHalalas;
}

/**
 * Has this entity already been verified with this product recently enough to be free.
 *
 * Practice four in the blueprint's competitive list: re-verifying the same entity within
 * thirty days costs nothing. It is a plan figure rather than a constant, because the
 * customer who negotiates sixty will exist.
 */
export async function isFreeReverification(
  tx: TenantTransaction,
  input: { entityId: string; productCode: string; withinDays: number },
): Promise<boolean> {
  if (input.withinDays <= 0) {
    return false;
  }

  const { rows } = await tx.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM verification_runs
       WHERE tenant_id = $1 AND entity_id = $2 AND product_code = $3
         AND status <> 'ERROR' AND billed_amount > 0
         AND created_at > now() - make_interval(days => $4)
     ) AS exists`,
    [tx.tenantId, input.entityId, input.productCode, input.withinDays],
  );
  return rows[0]?.exists ?? false;
}

/**
 * Renews a commitment into its next term.
 *
 * Usage is not reset, it is left behind: counters are per calendar month, so last term's
 * numbers stay readable and an invoice can still be explained a year later.
 */
export async function renewTerm(db: Queryable, tenantId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE tenant_commitments
     SET term_start = term_end,
         term_end = term_end + make_interval(months => term_months),
         updated_at = now()
     WHERE tenant_id = $1 AND term_end <= now()`,
    [tenantId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The ceilings a plan sells by the count, and the one it sells by the minute (ADR-184).
 *
 * `packages` has carried `max_api_keys`, `max_monitors`, `max_users` and `rate_limit_rpm`
 * since the table existed. Every plan set them, the operator panel edited them, `getCommitment`
 * read them into `Commitment`, and nothing else in the platform ever looked at them again: keys
 * and monitors were opened without a count, and the API applied one ceiling of a hundred and
 * twenty calls a minute to every subscriber alike. An enterprise that bought six hundred was
 * refused at a fifth of it; an essential plan that sold two keys handed out forty. This is the
 * same defect that was fixed for the overage price: a figure set in the panel, shown to the
 * buyer, and read by nobody.
 *
 * Three rules hold everywhere below.
 *
 *   - **Null is no ceiling.** It is the enterprise plan's answer and it is not zero. A zero
 *     would be a plan that sells none of the thing, and the table's own CHECK forbids it.
 *   - **A ceiling stops the next one, never the ones already there.** A workspace holding
 *     twelve keys that moves onto a plan selling ten keeps its twelve: revoking a credential
 *     somebody's integration is authenticating with, to enforce a number they have just agreed
 *     to, would break a running system to make a screen tidy. It may open no thirteenth, the
 *     screen says so in as many words, and the count comes down as they retire keys.
 *   - **No commitment sells no ceiling.** A workspace with no plan behind it has bought
 *     nothing to be capped at, and the entitlement layer already refuses it every verification.
 */

export type PlanLimitKind = 'API_KEYS' | 'MONITORS' | 'USERS';

export interface PlanLimit {
  kind: PlanLimitKind;
  /** Calls the plan sells. Null is no ceiling, and is never zero. */
  limit: number | null;
  used: number;
  /** What may still be opened. Null with no ceiling, and never below zero. */
  remaining: number | null;
  /** The next one is refused. */
  atLimit: boolean;
  /** Already above a ceiling acquired later. Nothing is taken away, nothing may be added. */
  over: boolean;
}

export interface PlanLimits {
  apiKeys: PlanLimit;
  monitors: PlanLimit;
  users: PlanLimit;
  /** Calls a minute the plan sells. */
  rateLimitRpm: number;
  /** True when a plan is behind these figures at all. */
  committed: boolean;
}

/**
 * What the API layer applies to a caller with no plan behind the key.
 *
 * The same figure `apps/api` has hard coded since the rate limiter was registered, named here
 * so that the floor and the plan's ceiling are read from one place rather than two.
 */
export const DEFAULT_RATE_LIMIT_RPM = 120;

/**
 * Which column sells each ceiling, and what counts against it.
 *
 * A revoked key is not a key: it authenticates nothing and holding one should not cost a slot.
 * A disabled user is not a seat either, which is the same rule `computeTermExtras` bills on, so
 * the number that is charged for and the number that is capped cannot drift apart. Every
 * monitor counts, paused or exhausted included, because each is a row its owner can revive
 * with one press and a cap that a pause walks around is not a cap.
 *
 * Both halves are compile time constants chosen by a closed union, never anything a caller
 * supplies, which is what makes interpolating them into the statement safe.
 */
const PLAN_LIMIT_SOURCES: Record<PlanLimitKind, { column: string; counted: string }> = {
  API_KEYS: {
    column: 'max_api_keys',
    counted: `SELECT count(*) FROM api_keys WHERE tenant_id = $1 AND revoked_at IS NULL`,
  },
  MONITORS: {
    column: 'max_monitors',
    counted: `SELECT count(*) FROM monitors WHERE tenant_id = $1`,
  },
  USERS: {
    column: 'max_users',
    counted: `SELECT count(*) FROM users WHERE tenant_id = $1 AND status = 'active'`,
  },
};

const PLAN_LIMIT_NOUN_AR: Record<PlanLimitKind, string> = {
  API_KEYS: 'مفاتيح',
  MONITORS: 'مراقبة',
  USERS: 'مستخدمين',
};

const PLAN_LIMIT_NOUN_EN: Record<PlanLimitKind, string> = {
  API_KEYS: 'API keys',
  MONITORS: 'monitors',
  USERS: 'users',
};

/**
 * The refusal, with the number in it.
 *
 * «ممنوع» tells somebody to open a support ticket. «You have reached your plan's limit: 10 API
 * keys» tells them what to revoke or what to buy, which is the entire difference between a
 * refusal that ends the afternoon and one that ends the sentence.
 */
export function planLimitRefusal(
  kind: PlanLimitKind,
  limit: number,
): { ar: string; en: string } {
  return {
    ar: `بلغتَ حدّ باقتك: ${limit} ${PLAN_LIMIT_NOUN_AR[kind]}`,
    en: `Plan limit reached: ${limit} ${PLAN_LIMIT_NOUN_EN[kind]}`,
  };
}

function describeLimit(kind: PlanLimitKind, limit: number | null, used: number): PlanLimit {
  if (limit === null) {
    return { kind, limit: null, used, remaining: null, atLimit: false, over: false };
  }
  return {
    kind,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    atLimit: used >= limit,
    over: used > limit,
  };
}

/**
 * One ceiling and what stands against it, in a single round trip.
 *
 * The plan's figure and the workspace's count are read together because they are one answer,
 * and because this sits in front of an insert: asking twice would put two round trips on the
 * path of every key, monitor and invitation to read a number that changes on neither.
 */
export async function planLimitFor(
  tx: TenantTransaction,
  kind: PlanLimitKind,
): Promise<PlanLimit> {
  const source = PLAN_LIMIT_SOURCES[kind];
  const { rows } = await tx.query<{ ceiling: number | null; used: string }>(
    `SELECT (SELECT p.${source.column}
               FROM tenant_commitments s
               JOIN packages p ON p.code = s.package_code
              WHERE s.tenant_id = $1) AS ceiling,
            (${source.counted}) AS used`,
    [tx.tenantId],
  );

  return describeLimit(kind, rows[0]?.ceiling ?? null, Number(rows[0]?.used ?? 0));
}

/**
 * Every ceiling at once, for the screen that shows them before anybody meets one.
 *
 * A limit a subscriber only discovers as a refusal is a limit they experience as a fault in
 * the platform. This is the read behind «الباقة والرصيد», so the plan says what it grants in
 * the same place it says what it costs.
 */
export async function planLimits(tx: TenantTransaction): Promise<PlanLimits> {
  const { rows } = await tx.query<{
    committed: boolean;
    max_api_keys: number | null;
    max_monitors: number | null;
    max_users: number | null;
    rate_limit_rpm: number | null;
    api_keys: string;
    monitors: string;
    users: string;
  }>(
    // Outward from a single row, so a workspace with no commitment answers with counts and
    // nulls rather than with nothing at all: the screen has to draw either way.
    `SELECT (s.tenant_id IS NOT NULL) AS committed,
            p.max_api_keys, p.max_monitors, p.max_users, p.rate_limit_rpm,
            (${PLAN_LIMIT_SOURCES.API_KEYS.counted}) AS api_keys,
            (${PLAN_LIMIT_SOURCES.MONITORS.counted}) AS monitors,
            (${PLAN_LIMIT_SOURCES.USERS.counted}) AS users
       FROM (SELECT 1) one
       LEFT JOIN tenant_commitments s ON s.tenant_id = $1
       LEFT JOIN packages p ON p.code = s.package_code`,
    [tx.tenantId],
  );

  const row = rows[0];
  return {
    apiKeys: describeLimit('API_KEYS', row?.max_api_keys ?? null, Number(row?.api_keys ?? 0)),
    monitors: describeLimit('MONITORS', row?.max_monitors ?? null, Number(row?.monitors ?? 0)),
    users: describeLimit('USERS', row?.max_users ?? null, Number(row?.users ?? 0)),
    rateLimitRpm: row?.rate_limit_rpm ?? DEFAULT_RATE_LIMIT_RPM,
    committed: row?.committed ?? false,
  };
}

/**
 * Refuses the next one when the plan's ceiling is already met, and says the number.
 *
 * Called by the thing that inserts rather than by each screen that leads to it, because there
 * are several ways to open a key, a monitor or a seat and a check written into one of them
 * protects one of them.
 */
export async function assertUnderPlanLimit(
  tx: TenantTransaction,
  kind: PlanLimitKind,
): Promise<PlanLimit> {
  const limit = await planLimitFor(tx, kind);
  if (limit.limit !== null && limit.atLimit) {
    throw new NxError('NX-4003', { detail: planLimitRefusal(kind, limit.limit).en });
  }
  return limit;
}

/**
 * The calls a minute this workspace bought.
 *
 * The API's rate limiter is registered once for the whole process, so this returns the figure
 * rather than applying it: the layer that holds the limiter reads the tenant's ceiling here and
 * applies it per key, and answers a caller past it with NX-4029, which is already the
 * catalogue's retryable 429 and already carries Retry-After from the limiter.
 */
export async function rateLimitRpmFor(tx: TenantTransaction): Promise<number> {
  const { rows } = await tx.query<{ rate_limit_rpm: number }>(
    `SELECT p.rate_limit_rpm
       FROM tenant_commitments s
       JOIN packages p ON p.code = s.package_code
      WHERE s.tenant_id = $1`,
    [tx.tenantId],
  );
  return rows[0]?.rate_limit_rpm ?? DEFAULT_RATE_LIMIT_RPM;
}
