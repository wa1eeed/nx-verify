import type { Queryable } from '../client.js';

/**
 * The packages a deployment starts with.
 *
 * Three, because a B2B catalogue with more than three plans is a catalogue nobody can
 * explain on a call, and every real deal is the nearest plan plus an override. The
 * operator edits these in the panel; nothing here is read at runtime.
 *
 * The shape of the ladder is deliberate. The entry plan covers what every customer starts
 * with, registry and address. The middle plan adds the bank account, which is where most
 * of the value and most of the cost is. The top plan turns everything on and stops
 * counting, because an enterprise that has to count is an enterprise that will call.
 *
 * The figures are the owner's, from the pricing work behind the first real quotation, and
 * two of them settle questions ADR-067 deliberately left open as plan fields:
 *
 *   - The annual plans name a platform and support fee rather than folding it into the
 *     unit price, so a buyer can see what the platform costs and what a verification
 *     costs, and argue with each separately.
 *   - A plan that sells capacity lets that capacity expire with the term. Capacity is not
 *     credit: three thousand verifications bought for a year are a year's worth, and
 *     carrying the unused part forward turns a commitment into a balance.
 *
 * The pay as you go plan keeps neither, because it commits to nothing and therefore has
 * nothing to carry or to charge a platform fee for.
 *
 * Per service prices sit on the plan rather than only in a price book, because they
 * differ by service by a factor of five: an address check is not a company file, and one
 * blended figure would either overcharge the cheap call or undercharge the expensive one.
 */

export interface SeedPackage {
  code: string;
  /** How this plan is sold. A buyer asks for these three and compares them. */
  billingModel?: 'PAYG' | 'MONTHLY' | 'ANNUAL';
  /** Transactions the term includes. Null or absent means capacity is not how it sells. */
  includedTransactions?: number | null;
  /** A flat price past the capacity. Absent defers to the price book. */
  overageUnitHalalas?: number | null;
  /** Named separately in an offer. Zero, which is the blueprint's position, by default. */
  platformFeeHalalas?: number;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  termMonths: 3 | 12 | 24;
  commitmentCreditsHalalas: number;
  setupFeeHalalas: number;
  setupWaivedFromMonths: number | null;
  creditRolloverDays: number;
  includedSeats: number;
  extraSeatHalalas: number;
  includedPortfolios: number;
  extraPortfolioHalalas: number;
  freeReverifyDays: number;
  overageAllowed: boolean;
  maxUsers: number | null;
  maxApiKeys: number | null;
  maxMonitors: number | null;
  rateLimitRpm: number;
  supportTier: 'STANDARD' | 'PRIORITY' | 'DEDICATED';
  sortOrder: number;
  /** Modules this package turns on. A product absent from the list is not included. */
  products: { code: string; monthlyQuota?: number | null; unitPriceHalalas?: number | null }[];
}

export const SEED_PACKAGES: readonly SeedPackage[] = [
  {
    /**
     * The plan a sandbox workspace runs on.
     *
     * Every module on, no capacity, and play money in the wallet. The prices are real,
     * because a buyer testing the integration should see what each call would have cost,
     * and because a billing path that is skipped in the sandbox is a billing path nobody
     * tested before the first invoice.
     */
    code: 'SANDBOX',
    nameAr: 'بيئة الاختبار',
    nameEn: 'Sandbox',
    descriptionAr: 'كل الوحدات مفعّلة، بمزوّد وهمي ورصيد تجريبي. لا يُحاسب عليها أحد.',
    billingModel: 'PAYG',
    includedTransactions: null,
    termMonths: 12,
    commitmentCreditsHalalas: 0,
    setupFeeHalalas: 0,
    setupWaivedFromMonths: null,
    creditRolloverDays: 0,
    includedSeats: 25,
    extraSeatHalalas: 0,
    includedPortfolios: 25,
    extraPortfolioHalalas: 0,
    // Nothing is free in a sandbox either, so that the figures on screen are the figures
    // a customer will see in production.
    freeReverifyDays: 0,
    overageAllowed: true,
    maxUsers: null,
    maxApiKeys: 5,
    maxMonitors: 25,
    rateLimitRpm: 120,
    supportTier: 'STANDARD',
    sortOrder: 1,
    products: [
      { code: 'ADDRESS_ONLY' },
      { code: 'KYB_COMPLETE' },
      { code: 'AOA_ONLY' },
      { code: 'MANAGER_PERMISSIONS' },
      { code: 'FREELANCER_CERTIFICATE' },
      { code: 'IBAN_OWNERSHIP' },
      { code: 'NAME_MATCH' },
      { code: 'BANK_ACCOUNT_OWNERSHIP' },
      { code: 'INCOME_VERIFICATION' },
    ],
  },
  {
    /**
     * No commitment, highest unit price.
     *
     * It exists to be compared against. A buyer who sees only a commitment cannot tell
     * whether it is a good one, and the first question in every negotiation is what the
     * alternative costs.
     */
    code: 'PAYG',
    nameAr: 'الدفع لكل عملية',
    nameEn: 'Pay per transaction',
    descriptionAr: 'بلا التزام وبلا رسوم ثابتة. السعر الأعلى لكل عملية، والوصول نفسه.',
    // The highest unit price, and it exists to be compared against: a buyer who sees only
    // a commitment cannot tell whether it is a good one.
    billingModel: 'PAYG',
    termMonths: 3,
    commitmentCreditsHalalas: 0,
    includedTransactions: null,
    setupFeeHalalas: 0,
    setupWaivedFromMonths: null,
    creditRolloverDays: 0,
    includedSeats: 3,
    extraSeatHalalas: 150_00,
    includedPortfolios: 1,
    extraPortfolioHalalas: 100_00,
    freeReverifyDays: 30,
    overageAllowed: true,
    maxUsers: null,
    maxApiKeys: 2,
    maxMonitors: 10,
    rateLimitRpm: 60,
    supportTier: 'STANDARD',
    sortOrder: 5,
    products: [
      { code: 'ADDRESS_ONLY', unitPriceHalalas: 6_00 },
      { code: 'KYB_COMPLETE', unitPriceHalalas: 25_00 },
      { code: 'AOA_ONLY', unitPriceHalalas: 25_00 },
      { code: 'MANAGER_PERMISSIONS', unitPriceHalalas: 25_00 },
      { code: 'FREELANCER_CERTIFICATE', unitPriceHalalas: 28_00 },
    ],
  },
  {
    code: 'ESSENTIAL',
    nameAr: 'الأساسية',
    nameEn: 'Essential',
    billingModel: 'MONTHLY',
    // A monthly minimum of two hundred and fifty, expressed as the year it adds up to.
    includedTransactions: 3_000,
    overageUnitHalalas: 20_00,
    platformFeeHalalas: 0,
    descriptionAr: 'التحقق من المنشأة والعنوان الوطني، بالتزام سنوي يعود كاملاً رصيد خدمات.',
    termMonths: 12,
    commitmentCreditsHalalas: 60_000_00,
    setupFeeHalalas: 3_000_00,
    setupWaivedFromMonths: 24,
    // Capacity, not credit: what a month's minimum did not use does not follow it.
    creditRolloverDays: 0,
    includedSeats: 5,
    extraSeatHalalas: 150_00,
    includedPortfolios: 3,
    extraPortfolioHalalas: 100_00,
    freeReverifyDays: 30,
    overageAllowed: true,
    maxUsers: null,
    maxApiKeys: 2,
    maxMonitors: 25,
    rateLimitRpm: 60,
    supportTier: 'STANDARD',
    sortOrder: 10,
    products: [
      { code: 'ADDRESS_ONLY' },
      { code: 'KYB_COMPLETE', monthlyQuota: 200 },
      { code: 'AOA_ONLY' },
      { code: 'MANAGER_PERMISSIONS' },
      { code: 'FREELANCER_CERTIFICATE' },
    ],
  },
  {
    code: 'GROWTH',
    nameAr: 'النمو',
    nameEn: 'Growth',
    billingModel: 'ANNUAL',
    includedTransactions: 3_000,
    overageUnitHalalas: 18_00,
    // Named rather than folded into the unit price, so the buyer can see what the
    // platform costs and what a verification costs and argue with each separately.
    platformFeeHalalas: 12_000_00,
    descriptionAr: 'كل ما في الأساسية، مع ملكية الآيبان وتأكيد الحساب البنكي ومطابقة الاسم والمراقبة المستمرة.',
    termMonths: 12,
    commitmentCreditsHalalas: 54_000_00,
    setupFeeHalalas: 3_000_00,
    setupWaivedFromMonths: 24,
    // Unused annual capacity expires with the term. Said in the offer, so it is a rule
    // here rather than a surprise in month thirteen.
    creditRolloverDays: 0,
    includedSeats: 15,
    extraSeatHalalas: 120_00,
    includedPortfolios: 10,
    extraPortfolioHalalas: 80_00,
    freeReverifyDays: 30,
    overageAllowed: true,
    maxUsers: null,
    maxApiKeys: 10,
    maxMonitors: 500,
    rateLimitRpm: 180,
    supportTier: 'PRIORITY',
    sortOrder: 20,
    products: [
      // The five services of the first quotation, each priced for what it costs rather
      // than blended: an address check is not a company file.
      { code: 'ADDRESS_ONLY', unitPriceHalalas: 4_00 },
      { code: 'KYB_COMPLETE', unitPriceHalalas: 18_00 },
      { code: 'AOA_ONLY', unitPriceHalalas: 18_00 },
      { code: 'MANAGER_PERMISSIONS', unitPriceHalalas: 18_00 },
      { code: 'FREELANCER_CERTIFICATE', unitPriceHalalas: 20_00 },
      { code: 'IBAN_OWNERSHIP', unitPriceHalalas: 12_00 },
      { code: 'NAME_MATCH', unitPriceHalalas: 8_00 },
      { code: 'BANK_ACCOUNT_OWNERSHIP', monthlyQuota: 500, unitPriceHalalas: 15_00 },
    ],
  },
  {
    code: 'ENTERPRISE',
    nameAr: 'المؤسسية',
    nameEn: 'Enterprise',
    billingModel: 'ANNUAL',
    includedTransactions: null,
    descriptionAr: 'كل وحدات التحقق بلا حدود عدّ، بما فيها إثبات الدخل، بالتزام أربعة وعشرين شهراً بلا رسم تأسيس ودعم مخصّص.',
    termMonths: 24,
    commitmentCreditsHalalas: 240_000_00,
    setupFeeHalalas: 0,
    setupWaivedFromMonths: 24,
    // Credit, not capacity, and the distinction is the whole reason both figures exist:
    // an enterprise commitment is money that comes back as usable credit, so what is
    // unused carries ninety days as the blueprint promises. A plan that sells a count of
    // verifications sells a year's worth of them, and those expire with the year.
    creditRolloverDays: 90,
    includedSeats: 50,
    extraSeatHalalas: 100_00,
    includedPortfolios: 50,
    extraPortfolioHalalas: 60_00,
    freeReverifyDays: 30,
    overageAllowed: true,
    maxUsers: null,
    maxApiKeys: null,
    maxMonitors: null,
    rateLimitRpm: 600,
    supportTier: 'DEDICATED',
    sortOrder: 30,
    products: [
      { code: 'ADDRESS_ONLY' },
      { code: 'KYB_COMPLETE' },
      { code: 'AOA_ONLY' },
      { code: 'MANAGER_PERMISSIONS' },
      { code: 'FREELANCER_CERTIFICATE' },
      { code: 'IBAN_OWNERSHIP' },
      { code: 'NAME_MATCH' },
      { code: 'BANK_ACCOUNT_OWNERSHIP' },
      { code: 'INCOME_VERIFICATION' },
      { code: 'PROPERTY_DEED' },
    ],
  },
];

export async function applyPackageSeed(
  db: Queryable,
  packages: readonly SeedPackage[] = SEED_PACKAGES,
): Promise<void> {
  for (const pack of packages) {
    await db.query(
      `INSERT INTO packages (code, name_ar, name_en, description_ar, term_months,
                             commitment_credits_halalas, setup_fee_halalas,
                             setup_waived_from_months, credit_rollover_days,
                             included_seats, extra_seat_halalas, included_portfolios,
                             extra_portfolio_halalas, free_reverify_days, overage_allowed,
                             max_users, max_api_keys, max_monitors, rate_limit_rpm,
                             support_tier, sort_order, billing_model, included_transactions,
                             overage_unit_halalas, platform_fee_halalas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
               $18, $19, $20, $21, $22, $23, $24, $25)
       ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         name_en = EXCLUDED.name_en,
         description_ar = EXCLUDED.description_ar,
         term_months = EXCLUDED.term_months,
         commitment_credits_halalas = EXCLUDED.commitment_credits_halalas,
         setup_fee_halalas = EXCLUDED.setup_fee_halalas,
         setup_waived_from_months = EXCLUDED.setup_waived_from_months,
         credit_rollover_days = EXCLUDED.credit_rollover_days,
         included_seats = EXCLUDED.included_seats,
         extra_seat_halalas = EXCLUDED.extra_seat_halalas,
         included_portfolios = EXCLUDED.included_portfolios,
         extra_portfolio_halalas = EXCLUDED.extra_portfolio_halalas,
         free_reverify_days = EXCLUDED.free_reverify_days,
         overage_allowed = EXCLUDED.overage_allowed,
         max_users = EXCLUDED.max_users,
         max_api_keys = EXCLUDED.max_api_keys,
         max_monitors = EXCLUDED.max_monitors,
         rate_limit_rpm = EXCLUDED.rate_limit_rpm,
         support_tier = EXCLUDED.support_tier,
         sort_order = EXCLUDED.sort_order,
         billing_model = EXCLUDED.billing_model,
         included_transactions = EXCLUDED.included_transactions,
         overage_unit_halalas = EXCLUDED.overage_unit_halalas,
         platform_fee_halalas = EXCLUDED.platform_fee_halalas,
         updated_at = now()`,
      [
        pack.code,
        pack.nameAr,
        pack.nameEn,
        pack.descriptionAr,
        pack.termMonths,
        pack.commitmentCreditsHalalas,
        pack.setupFeeHalalas,
        pack.setupWaivedFromMonths,
        pack.creditRolloverDays,
        pack.includedSeats,
        pack.extraSeatHalalas,
        pack.includedPortfolios,
        pack.extraPortfolioHalalas,
        pack.freeReverifyDays,
        pack.overageAllowed,
        pack.maxUsers,
        pack.maxApiKeys,
        pack.maxMonitors,
        pack.rateLimitRpm,
        pack.supportTier,
        pack.sortOrder,
        pack.billingModel ?? 'ANNUAL',
        pack.includedTransactions ?? null,
        pack.overageUnitHalalas ?? null,
        pack.platformFeeHalalas ?? 0,
      ],
    );

    for (const product of pack.products) {
      await db.query(
        `INSERT INTO package_products (package_code, product_code, enabled, monthly_quota,
                                       unit_price_halalas)
         VALUES ($1, $2, true, $3, $4)
         ON CONFLICT (package_code, product_code) DO UPDATE SET
           enabled = true,
           monthly_quota = EXCLUDED.monthly_quota,
           unit_price_halalas = EXCLUDED.unit_price_halalas`,
        [pack.code, product.code, product.monthlyQuota ?? null, product.unitPriceHalalas ?? null],
      );
    }
  }
}
