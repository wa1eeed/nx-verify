import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { riyalsToHalalas } from './money.js';

/**
 * Price resolution and the margin guard.
 *
 * Precedence, from docs/03-products.md section 6: contract, then tenant, then tier, then
 * the default list. The most specific row wins, and only one row of a given specificity
 * may be open at a time, which the unique index enforces.
 *
 * Every run is priced by the row in force at its created_at. That is why prices are
 * versioned rather than edited: re-pricing the past is how a customer loses trust in an
 * invoice, and it cannot happen if the old row still exists.
 */

export interface PriceRow {
  id: string;
  productCode: string;
  tenantId: string | null;
  contractId: string | null;
  /** In halalas. */
  unitPrice: number;
  tierMin: number;
  tierMax: number | null;
  negativePct: number;
  cachePct: number;
  version: number;
}

export interface ResolvePriceOptions {
  contractId?: string | null;
  /** Volume used to pick a tier. */
  units?: number;
  /** Prices the run as of this instant, so a replay prices identically. */
  asOf?: Date;
}

export async function resolvePrice(
  tx: TenantTransaction,
  productCode: string,
  options: ResolvePriceOptions = {},
): Promise<PriceRow> {
  const asOf = options.asOf ?? new Date();
  const units = options.units ?? 0;

  const { rows } = await tx.query<{
    id: string;
    product_code: string;
    tenant_id: string | null;
    contract_id: string | null;
    unit_price: string;
    tier_min: number;
    tier_max: number | null;
    negative_pct: string;
    cache_pct: string;
    version: number;
  }>(
    `SELECT id, product_code, tenant_id, contract_id, unit_price, tier_min, tier_max,
            negative_pct, cache_pct, version
     FROM price_book
     WHERE product_code = $1
       AND (tenant_id IS NULL OR tenant_id = $2)
       AND ($3::uuid IS NULL OR contract_id IS NULL OR contract_id = $3)
       AND valid_from <= $4
       AND (valid_to IS NULL OR valid_to > $4)
       AND tier_min <= $5
       AND (tier_max IS NULL OR tier_max > $5)
     ORDER BY
       -- contract, then tenant, then the default list
       (contract_id IS NOT NULL AND contract_id = $3::uuid) DESC,
       (tenant_id IS NOT NULL) DESC,
       tier_min DESC,
       valid_from DESC
     LIMIT 1`,
    [productCode, tx.tenantId, options.contractId ?? null, asOf, units],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', { detail: `no price is in force for product ${productCode}` });
  }

  return {
    id: row.id,
    productCode: row.product_code,
    tenantId: row.tenant_id,
    contractId: row.contract_id,
    unitPrice: riyalsToHalalas(row.unit_price),
    tierMin: row.tier_min,
    tierMax: row.tier_max,
    negativePct: Number(row.negative_pct),
    cachePct: Number(row.cache_pct),
    version: row.version,
  };
}

export interface MarginCheck {
  productCode: string;
  /** Sum of provider costs for one full run, in halalas. */
  totalCost: number;
  unitPrice: number;
  margin: number;
  meetsMinimum: boolean;
}

/**
 * The margin guard.
 *
 * The database only checks that a price is above zero. The real check is here, because
 * it needs the sum of provider costs for the product's steps. Run it when a price is
 * saved, and again across every open contract whenever a provider raises its price.
 */
export async function checkMargin(
  tx: TenantTransaction,
  productCode: string,
  unitPriceHalalas: number,
  minimumMargin = 0.3,
): Promise<MarginCheck> {
  const { rows } = await tx.query<{ total: string | null }>(
    `SELECT COALESCE(sum(c.unit_cost), 0)::text AS total
     FROM product_steps s
     JOIN LATERAL (
       SELECT unit_cost
       FROM cost_book
       WHERE provider = s.provider AND endpoint = s.endpoint
         AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
       ORDER BY valid_from DESC
       LIMIT 1
     ) c ON true
     WHERE s.product_code = $1`,
    [productCode],
  );

  const totalCost = riyalsToHalalas(rows[0]?.total ?? '0');
  const margin = totalCost === 0 ? 1 : (unitPriceHalalas - totalCost) / unitPriceHalalas;

  return {
    productCode,
    totalCost,
    unitPrice: unitPriceHalalas,
    margin,
    meetsMinimum: margin >= minimumMargin,
  };
}

export interface OpenPriceInput {
  productCode: string;
  unitPriceHalalas: number;
  tierMin?: number;
  tierMax?: number | null;
  negativePct?: number;
  cachePct?: number;
  contractId?: string | null;
}

/**
 * Opens a new price version and closes the one it replaces.
 *
 * Never an edit. The trigger in migration 0011 refuses any update other than closing an
 * open row, so this is the only way a price can change.
 */
export async function openPriceVersion(
  tx: TenantTransaction,
  input: OpenPriceInput,
): Promise<string> {
  const { halalasToDecimalString } = await import('./money.js');

  const { rows: current } = await tx.query<{ id: string; version: number }>(
    `SELECT id, version FROM price_book
     WHERE product_code = $1 AND tenant_id = $2 AND tier_min = $3
       AND contract_id IS NOT DISTINCT FROM $4 AND valid_to IS NULL
     FOR UPDATE`,
    [input.productCode, tx.tenantId, input.tierMin ?? 0, input.contractId ?? null],
  );

  const previous = current[0];
  if (previous) {
    await tx.query('UPDATE price_book SET valid_to = now() WHERE id = $1', [previous.id]);
  }

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO price_book (tenant_id, product_code, unit_price, tier_min, tier_max,
                             negative_pct, cache_pct, version, contract_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      tx.tenantId,
      input.productCode,
      halalasToDecimalString(input.unitPriceHalalas),
      input.tierMin ?? 0,
      input.tierMax ?? null,
      input.negativePct ?? 0.5,
      input.cachePct ?? 1,
      (previous?.version ?? 0) + 1,
      input.contractId ?? null,
    ],
  );

  const id = rows[0]?.id;
  if (!id) {
    throw new NxError('NX-5001', { detail: 'price insert returned no id' });
  }
  return id;
}
