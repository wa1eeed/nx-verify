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
  | 'QUOTA_EXHAUSTED';

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
}

/**
 * One query, because entitlement is read before every run and a run must not cost five
 * round trips before it starts.
 */
const ENTITLEMENT_SQL = `
  SELECT p.code AS product_code,
         s.package_code,
         s.status AS subscription_status,
         s.current_period_start AS period_start,
         s.current_period_end AS period_end,
         pp.enabled AS package_enabled,
         pp.monthly_quota AS package_quota,
         pp.unit_price_halalas AS package_price,
         o.enabled AS override_enabled,
         o.monthly_quota AS override_quota,
         o.unit_price_halalas AS override_price,
         u.used
  FROM products p
  LEFT JOIN tenant_subscriptions s ON s.tenant_id = $1
  LEFT JOIN package_products pp
    ON pp.package_code = s.package_code AND pp.product_code = p.code
  LEFT JOIN tenant_product_overrides o
    ON o.tenant_id = $1 AND o.product_code = p.code
  LEFT JOIN product_usage u
    ON u.tenant_id = $1 AND u.product_code = p.code
   AND u.period_start = date_trunc('month', coalesce(s.current_period_start, now()))::date
  WHERE p.status = 'active' AND ($2::text IS NULL OR p.code = $2)
  ORDER BY p.code
`;

function decide(row: EntitlementRow): Entitlement {
  const used = row.used ?? 0;
  const negotiated = row.override_enabled !== null || row.override_quota !== null || row.override_price !== null;

  const base: Omit<Entitlement, 'allowed' | 'refusal' | 'remaining'> = {
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
  await tx.query(
    `INSERT INTO product_usage (tenant_id, period_start, product_code, used)
     VALUES ($1,
             date_trunc('month', coalesce(
               (SELECT current_period_start FROM tenant_subscriptions WHERE tenant_id = $1),
               now()))::date,
             $2, 1)
     ON CONFLICT (tenant_id, period_start, product_code)
     DO UPDATE SET used = product_usage.used + 1, updated_at = now()`,
    [tx.tenantId, productCode],
  );
}

export interface Subscription {
  packageCode: string;
  packageNameAr: string;
  status: string;
  monthlyFeeHalalas: number;
  includedCreditsHalalas: number;
  overageAllowed: boolean;
  maxUsers: number | null;
  maxApiKeys: number | null;
  maxMonitors: number | null;
  rateLimitRpm: number;
  supportTier: string;
  periodStart: Date;
  periodEnd: Date;
  trialEndsAt: Date | null;
}

export async function getSubscription(tx: TenantTransaction): Promise<Subscription | null> {
  const { rows } = await tx.query<{
    package_code: string;
    name_ar: string;
    status: string;
    monthly_fee_halalas: number;
    included_credits_halalas: number;
    overage_allowed: boolean;
    max_users: number | null;
    max_api_keys: number | null;
    max_monitors: number | null;
    rate_limit_rpm: number;
    support_tier: string;
    current_period_start: Date;
    current_period_end: Date;
    trial_ends_at: Date | null;
  }>(
    `SELECT s.package_code, p.name_ar, s.status, p.monthly_fee_halalas,
            p.included_credits_halalas, p.overage_allowed, p.max_users, p.max_api_keys,
            p.max_monitors, p.rate_limit_rpm, p.support_tier,
            s.current_period_start, s.current_period_end, s.trial_ends_at
     FROM tenant_subscriptions s
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
    monthlyFeeHalalas: row.monthly_fee_halalas,
    includedCreditsHalalas: row.included_credits_halalas,
    overageAllowed: row.overage_allowed,
    maxUsers: row.max_users,
    maxApiKeys: row.max_api_keys,
    maxMonitors: row.max_monitors,
    rateLimitRpm: row.rate_limit_rpm,
    supportTier: row.support_tier,
    periodStart: row.current_period_start,
    periodEnd: row.current_period_end,
    trialEndsAt: row.trial_ends_at,
  };
}

/**
 * Rolls a subscriber into the next cycle.
 *
 * Usage is not reset, it is left behind: a new period has its own counter row, so last
 * month's numbers remain readable and an invoice can still be explained in March.
 */
export async function advancePeriod(db: Queryable, tenantId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE tenant_subscriptions
     SET current_period_start = current_period_end,
         current_period_end = current_period_end + (current_period_end - current_period_start),
         updated_at = now()
     WHERE tenant_id = $1 AND current_period_end <= now()`,
    [tenantId],
  );
  return (rowCount ?? 0) > 0;
}
