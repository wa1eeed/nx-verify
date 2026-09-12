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
  /** True when this product is on because somebody wrote a line for this subscriber. */
  negotiated: boolean;
  /** Transactions left in the term's capacity. Null when the plan sells no capacity. */
  capacityRemaining: number | null;
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
  used: number | null;
  included_transactions: number | null;
  transactions_used: number | null;
  overage_allowed: boolean | null;
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
         pk.overage_allowed
  FROM products p
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
  const negotiated = row.override_enabled !== null || row.override_quota !== null || row.override_price !== null;

  const capacity = row.included_transactions;
  const capacityUsed = row.transactions_used ?? 0;
  const capacityRemaining = capacity === null ? null : Math.max(0, capacity - capacityUsed);

  const base: Omit<Entitlement, 'allowed' | 'refusal' | 'remaining'> = {
    capacityRemaining,
    productCode: row.product_code,
    packageCode: row.package_code,
    quota: row.override_quota ?? row.package_quota,
    used,
    unitPriceHalalas: row.override_price ?? row.package_price,
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

  if (row.override_enabled !== true) {
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
