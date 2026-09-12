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
 */

export interface SeedPackage {
  code: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  monthlyFeeHalalas: number;
  includedCreditsHalalas: number;
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
    descriptionAr: 'التحقق من المنشأة والعنوان الوطني، لفريق صغير يبدأ.',
    monthlyFeeHalalas: 1_500_00,
    includedCreditsHalalas: 1_000_00,
    overageAllowed: true,
    maxUsers: 5,
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
    descriptionAr: 'كل ما في الأساسية، مع ملكية الآيبان والمراقبة المستمرة.',
    monthlyFeeHalalas: 5_000_00,
    includedCreditsHalalas: 4_000_00,
    overageAllowed: true,
    maxUsers: 25,
    maxApiKeys: 10,
    maxMonitors: 500,
    rateLimitRpm: 180,
    supportTier: 'PRIORITY',
    sortOrder: 20,
    products: [{ code: 'ADDRESS_ONLY' }, { code: 'KYB_COMPLETE' }, { code: 'IBAN_OWNERSHIP' }],
  },
  {
    code: 'ENTERPRISE',
    nameAr: 'المؤسسية',
    nameEn: 'Enterprise',
    descriptionAr: 'كل وحدات التحقق بلا حدود عدّ، ودعم مخصّص.',
    monthlyFeeHalalas: 20_000_00,
    includedCreditsHalalas: 18_000_00,
    overageAllowed: true,
    maxUsers: null,
    maxApiKeys: null,
    maxMonitors: null,
    rateLimitRpm: 600,
    supportTier: 'DEDICATED',
    sortOrder: 30,
    products: [{ code: 'ADDRESS_ONLY' }, { code: 'KYB_COMPLETE' }, { code: 'IBAN_OWNERSHIP' }],
  },
];

export async function applyPackageSeed(
  db: Queryable,
  packages: readonly SeedPackage[] = SEED_PACKAGES,
): Promise<void> {
  for (const pack of packages) {
    await db.query(
      `INSERT INTO packages (code, name_ar, name_en, description_ar, monthly_fee_halalas,
                             included_credits_halalas, overage_allowed, max_users,
                             max_api_keys, max_monitors, rate_limit_rpm, support_tier,
                             sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         name_en = EXCLUDED.name_en,
         description_ar = EXCLUDED.description_ar,
         monthly_fee_halalas = EXCLUDED.monthly_fee_halalas,
         included_credits_halalas = EXCLUDED.included_credits_halalas,
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
        pack.monthlyFeeHalalas,
        pack.includedCreditsHalalas,
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
