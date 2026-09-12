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
 * The figures follow docs/01-blueprint.md section 9 and not a monthly subscription: a
 * term, the credit that term grants, a setup fee waived at twenty four months, included
 * seats and portfolios with a price for extras, and ninety days of rollover. The platform
 * itself carries no fee, which is the sentence that kills the "why am I paying a
 * subscription" objection: every riyal comes back as usable credit.
 */

export interface SeedPackage {
  code: string;
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
    code: 'ESSENTIAL',
    nameAr: 'الأساسية',
    nameEn: 'Essential',
    descriptionAr: 'التحقق من المنشأة والعنوان الوطني، بالتزام سنوي يعود كاملاً رصيد خدمات.',
    termMonths: 12,
    commitmentCreditsHalalas: 18_000_00,
    setupFeeHalalas: 3_000_00,
    setupWaivedFromMonths: 24,
    creditRolloverDays: 90,
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
    products: [{ code: 'ADDRESS_ONLY' }, { code: 'KYB_COMPLETE', monthlyQuota: 200 }],
  },
  {
    code: 'GROWTH',
    nameAr: 'النمو',
    nameEn: 'Growth',
    descriptionAr: 'كل ما في الأساسية، مع ملكية الآيبان وتأكيد الحساب البنكي ومطابقة الاسم والمراقبة المستمرة.',
    termMonths: 12,
    commitmentCreditsHalalas: 60_000_00,
    setupFeeHalalas: 3_000_00,
    setupWaivedFromMonths: 24,
    creditRolloverDays: 90,
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
      { code: 'ADDRESS_ONLY' },
      { code: 'KYB_COMPLETE' },
      { code: 'IBAN_OWNERSHIP' },
      { code: 'NAME_MATCH' },
      { code: 'BANK_ACCOUNT_OWNERSHIP', monthlyQuota: 500 },
    ],
  },
  {
    code: 'ENTERPRISE',
    nameAr: 'المؤسسية',
    nameEn: 'Enterprise',
    descriptionAr: 'كل وحدات التحقق بلا حدود عدّ، بما فيها إثبات الدخل، بالتزام أربعة وعشرين شهراً بلا رسم تأسيس ودعم مخصّص.',
    termMonths: 24,
    commitmentCreditsHalalas: 240_000_00,
    setupFeeHalalas: 0,
    setupWaivedFromMonths: 24,
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
      { code: 'IBAN_OWNERSHIP' },
      { code: 'NAME_MATCH' },
      { code: 'BANK_ACCOUNT_OWNERSHIP' },
      { code: 'INCOME_VERIFICATION' },
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
                             support_tier, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
               $18, $19, $20, $21)
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
