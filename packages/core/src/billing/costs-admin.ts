import type { Queryable } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { recordOperatorAudit } from '../operators/audit.js';
import { operatorCan, type OperatorIdentity } from '../operators/accounts.js';
import { halalasToDecimalString } from './money.js';
import { costToUs, vatInForce, type VatRule } from './vat.js';

/**
 * What a provider call costs us, recorded from the panel (ADR-166).
 *
 * Every margin figure the platform shows is arithmetic on this table, and until now the panel
 * could only read it: the rates were seeded from a file, so the margin was right for exactly
 * as long as that file happened to match the contract. An owner who signed a new rate had
 * nowhere to put it, and the routing screen's whole premise (a provider raised their price,
 * move this service to another) could not be acted on at all.
 *
 * Versioned like the price book, for the same reason. A cost is a fact about a period: a run
 * billed in March has to stay measurable against what that call cost in March. So a new rate
 * closes the open row and opens another, and nothing is ever edited in place.
 *
 * The tax inside the bill is recorded separately, because whether it is a cost or reclaimable
 * depends on the day (ADR-157). Providers here are VAT registered and we are not, so today
 * their tax is simply part of what we pay.
 */

export interface ProviderCostRow {
  provider: string;
  /** The provider's Arabic name, when the catalogue knows it. Panel only (rule 5). */
  providerNameAr: string | null;
  endpoint: string;
  /** What they bill us for one call, tax included, in halalas. */
  billedHalalas: number;
  /** How much of that is tax: 1500 is 15%. */
  vatBps: number;
  /** What the call actually costs us once tax is reclaimable, under today's rule. */
  effectiveHalalas: number;
  validFrom: Date;
  /**
   * How many catalogue products make this call, so a rate change shows its blast radius.
   *
   * Zero is a real and interesting answer: the seeded cost book carries rates for calls no
   * product makes any more, and a cost nothing reads is a number somebody will one day
   * reconcile against a provider invoice and not find.
   */
  usedByProducts: number;
}

/**
 * Every open cost, with what it touches.
 *
 * The product count is the figure that makes this screen safe to act on: raising one endpoint
 * by a riyal is a different decision when it is one product and when it is nine.
 */
export async function listProviderCosts(
  db: Queryable,
  now: Date = new Date(),
): Promise<ProviderCostRow[]> {
  const rule = await vatInForce(db, now);
  const { rows } = await db.query<{
    provider: string;
    provider_name_ar: string | null;
    endpoint: string;
    unit_cost: string;
    vat_bps: number;
    valid_from: Date;
    used_by: string;
  }>(
    `SELECT c.provider, cat.name_ar AS provider_name_ar, c.endpoint,
            c.unit_cost::text AS unit_cost, c.vat_bps, c.valid_from,
            (SELECT count(DISTINCT s.product_code)::text
               FROM product_steps s
              WHERE s.provider = c.provider AND s.endpoint = c.endpoint) AS used_by
       FROM cost_book c
       LEFT JOIN provider_catalog cat ON cat.code = c.provider
      WHERE c.valid_to IS NULL
      ORDER BY c.provider, c.endpoint`,
  );

  return rows.map((row) => {
    const billed = Math.round(Number(row.unit_cost) * 100);
    return {
      provider: row.provider,
      providerNameAr: row.provider_name_ar,
      endpoint: row.endpoint,
      billedHalalas: billed,
      vatBps: Number(row.vat_bps),
      effectiveHalalas: costToUs(billed, Number(row.vat_bps), rule),
      validFrom: row.valid_from,
      usedByProducts: Number(row.used_by),
    };
  });
}

/**
 * A call the catalogue makes for which no cost is recorded.
 *
 * The gap that matters most: a product whose cost is unknown has a margin the platform is
 * inventing, and guard 10 measures its price against zero. Worth putting in front of somebody
 * rather than leaving to be noticed as a blank cell.
 */
export interface UnpricedCall {
  provider: string;
  providerNameAr: string | null;
  endpoint: string;
  usedByProducts: number;
}

export async function listUnpricedCalls(db: Queryable): Promise<UnpricedCall[]> {
  const { rows } = await db.query<{
    provider: string;
    provider_name_ar: string | null;
    endpoint: string;
    used_by: string;
  }>(
    `SELECT s.provider, cat.name_ar AS provider_name_ar, s.endpoint,
            count(DISTINCT s.product_code)::text AS used_by
       FROM product_steps s
       LEFT JOIN provider_catalog cat ON cat.code = s.provider
      WHERE NOT EXISTS (
        SELECT 1 FROM cost_book c
         WHERE c.provider = s.provider AND c.endpoint = s.endpoint AND c.valid_to IS NULL
      )
      GROUP BY s.provider, cat.name_ar, s.endpoint
      ORDER BY s.provider, s.endpoint`,
  );

  return rows.map((row) => ({
    provider: row.provider,
    providerNameAr: row.provider_name_ar,
    endpoint: row.endpoint,
    usedByProducts: Number(row.used_by),
  }));
}

export interface SetProviderCostInput {
  provider: string;
  endpoint: string;
  /** What they bill us for one call, tax included, in halalas. */
  billedHalalas: number;
  /** How much of the bill is tax. Zero for a provider who charges none. */
  vatBps: number;
  note?: string | null;
}

export interface CostChange {
  provider: string;
  endpoint: string;
  fromHalalas: number | null;
  toHalalas: number;
  /**
   * Products whose price is now under what they cost us.
   *
   * Recording a rate is not the moment to refuse it: the provider has already raised their
   * price, and pretending otherwise leaves the platform selling at the old margin with no
   * record of why. So the cost is recorded and the prices it broke are named, which is the
   * list somebody has to go and act on.
   */
  nowUnderCost: { productCode: string; nameAr: string; priceHalalas: number; costHalalas: number }[];
}

/**
 * Records a new rate from a date, closing whatever it replaces.
 *
 * Deliberately does not refuse a rate that makes a price unprofitable. Guard 10 stops us
 * setting a price under a known cost, which is a decision we control; a provider raising their
 * price is not, and a platform that refuses to write it down carries on quoting a margin that
 * no longer exists. It writes the cost and hands back the damage.
 */
export async function setProviderCost(
  db: Queryable,
  actor: OperatorIdentity,
  input: SetProviderCostInput,
): Promise<CostChange> {
  if (!operatorCan(actor.role, 'pricing')) {
    throw new NxError('NX-4031', { detail: 'this role does not change provider costs' });
  }
  if (!Number.isInteger(input.billedHalalas) || input.billedHalalas < 0) {
    throw new NxError('NX-4002', { detail: 'a cost is a whole number of halalas, at or above zero' });
  }
  if (!Number.isInteger(input.vatBps) || input.vatBps < 0 || input.vatBps > 10_000) {
    throw new NxError('NX-4002', { detail: 'the tax share is between nothing and everything' });
  }

  const { rows: known } = await db.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM product_steps WHERE provider = $1 AND endpoint = $2
     ) AS ok`,
    [input.provider, input.endpoint],
  );
  if (known[0]?.ok !== true) {
    // A cost for a call no product makes is a row nothing will ever read, and a typo in an
    // endpoint name is exactly how one gets created.
    throw new NxError('NX-4041', {
      detail: `no product makes ${input.provider}/${input.endpoint}`,
    });
  }

  const { rows: previous } = await db.query<{ unit_cost: string }>(
    `SELECT unit_cost::text FROM cost_book
      WHERE provider = $1 AND endpoint = $2 AND valid_to IS NULL`,
    [input.provider, input.endpoint],
  );
  const fromHalalas =
    previous[0] === undefined ? null : Math.round(Number(previous[0].unit_cost) * 100);

  if (fromHalalas === input.billedHalalas) {
    // Writing the same number again would close a row and open an identical one, which turns
    // a cost history into a log of somebody pressing save.
    return {
      provider: input.provider,
      endpoint: input.endpoint,
      fromHalalas,
      toHalalas: input.billedHalalas,
      nowUnderCost: await pricesUnderCost(db, input.provider, input.endpoint),
    };
  }

  await db.query(
    `UPDATE cost_book SET valid_to = now()
      WHERE provider = $1 AND endpoint = $2 AND valid_to IS NULL`,
    [input.provider, input.endpoint],
  );
  await db.query(
    `INSERT INTO cost_book (provider, endpoint, unit_cost, vat_bps)
     VALUES ($1, $2, $3::numeric, $4)`,
    [input.provider, input.endpoint, halalasToDecimalString(input.billedHalalas), input.vatBps],
  );

  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'pricing.provider_cost',
    target: `cost:${input.provider}:${input.endpoint}`,
    metadata: { from: fromHalalas, to: input.billedHalalas, vat_bps: input.vatBps },
  });

  return {
    provider: input.provider,
    endpoint: input.endpoint,
    fromHalalas,
    toHalalas: input.billedHalalas,
    nowUnderCost: await pricesUnderCost(db, input.provider, input.endpoint),
  };
}

/** Which list prices this call's new rate has put under water. */
async function pricesUnderCost(
  db: Queryable,
  provider: string,
  endpoint: string,
): Promise<CostChange['nowUnderCost']> {
  const { rows } = await db.query<{
    product_code: string;
    name_ar: string;
    price: string;
    cost: string;
  }>(
    `WITH touched AS (
       SELECT DISTINCT product_code FROM product_steps
        WHERE provider = $1 AND endpoint = $2
     ),
     cost AS (
       SELECT s.product_code, COALESCE(sum(c.unit_cost), 0) AS total
         FROM product_steps s
         JOIN touched t ON t.product_code = s.product_code
         LEFT JOIN LATERAL (
           SELECT unit_cost FROM cost_book
            WHERE provider = s.provider AND endpoint = s.endpoint AND valid_to IS NULL
            ORDER BY valid_from DESC LIMIT 1
         ) c ON true
        GROUP BY s.product_code
     )
     SELECT p.code AS product_code, p.name_ar, b.unit_price::text AS price, cost.total::text AS cost
       FROM cost
       JOIN products p ON p.code = cost.product_code
       JOIN LATERAL (
         SELECT unit_price FROM price_book
          WHERE product_code = p.code AND tenant_id IS NULL AND contract_id IS NULL
            AND tier_min = 0 AND valid_to IS NULL
          ORDER BY valid_from DESC LIMIT 1
       ) b ON true
      WHERE b.unit_price < cost.total
      ORDER BY p.code`,
    [provider, endpoint],
  );

  return rows.map((row) => ({
    productCode: row.product_code,
    nameAr: row.name_ar,
    priceHalalas: Math.round(Number(row.price) * 100),
    costHalalas: Math.round(Number(row.cost) * 100),
  }));
}

/** The rule in force, so a screen can say whether the tax in a bill is ours to eat. */
export async function costVatRule(db: Queryable, now: Date = new Date()): Promise<VatRule> {
  return vatInForce(db, now);
}
