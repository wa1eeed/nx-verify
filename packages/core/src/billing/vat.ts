import type { Queryable } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { recordOperatorAudit } from '../operators/audit.js';
import { operatorCan, type OperatorIdentity } from '../operators/accounts.js';

/**
 * Value added tax, as a period rather than a switch (ADR-157).
 *
 * The platform is not registered today. The providers we buy from are, so what they bill us
 * already includes tax and we cannot reclaim it: their VAT is part of our cost. When we
 * register, the price quoted to a subscriber becomes a final price with VAT in it, and the
 * VAT we pay providers stops being a cost. Both sides of the margin change on the same day.
 *
 * Which is why this is not a boolean. A switch flipped in March recomputes every invoice ever
 * issued with tax that did not apply when it was charged, and a February invoice reprinted in
 * April becomes a different document from the one the customer received. What is asked for
 * years later is the rule in force on the date of supply, so every calculation here takes a
 * date and reads the period that was in force then.
 *
 * Prices stay stored without tax, as they always were. Nothing in the price book changes on
 * the day we register: what changes is what is added to it at the moment of sale.
 */

export interface VatRule {
  /** Whether the platform was registered on the day asked about. */
  registered: boolean;
  /** 1500 is 15%. Carried even when unregistered, so a screen can show what would happen. */
  rateBps: number;
  registrationNumber: string | null;
}

export interface VatPeriod extends VatRule {
  effectiveFrom: string;
  note: string | null;
  setBy: string | null;
  setAt: Date;
}

/** The standard rate in the Kingdom, the default a new period is offered at. */
export const STANDARD_RATE_BPS = 1500;

export const UNREGISTERED: VatRule = { registered: false, rateBps: 0, registrationNumber: null };

function dayOf(when: Date): string {
  return when.toISOString().slice(0, 10);
}

/**
 * The rule in force on a day.
 *
 * Defaults to unregistered rather than throwing on an empty table: a platform with no VAT row
 * is an unregistered platform, and that is a real answer. The alternative is every caller
 * writing the same null check and one of them getting it wrong on an invoice.
 */
export async function vatInForce(db: Queryable, when: Date = new Date()): Promise<VatRule> {
  const { rows } = await db.query<{
    registered: boolean;
    rate_bps: number;
    registration_number: string | null;
  }>(`SELECT registered, rate_bps, registration_number FROM app.vat_on($1::date)`, [dayOf(when)]);

  const row = rows[0];
  return row === undefined
    ? UNREGISTERED
    : {
        registered: row.registered,
        rateBps: Number(row.rate_bps),
        registrationNumber: row.registration_number,
      };
}

export interface TaxedAmount {
  /** What the price list says, which is what it has always said. */
  netHalalas: number;
  /** Nothing at all while unregistered. Not zero because the rate is zero: because none is due. */
  vatHalalas: number;
  /** What the subscriber actually pays. */
  grossHalalas: number;
  rule: VatRule;
}

/**
 * What a net amount costs the buyer under a rule.
 *
 * An unregistered period adds nothing, and the screens read `vatHalalas === 0` to know not to
 * print a tax line at all. A zero line on an invoice from a seller who is not registered
 * claims something untrue about the seller.
 */
export function withVat(netHalalas: number, rule: VatRule): TaxedAmount {
  const vat = rule.registered ? Math.round((netHalalas * rule.rateBps) / 10_000) : 0;
  return {
    netHalalas,
    vatHalalas: vat,
    grossHalalas: netHalalas + vat,
    rule,
  };
}

/**
 * The part of a provider's bill that is tax, taken back out of it.
 *
 * Their invoice is one number. While we are not registered that number is our cost entire,
 * and the moment we are it stops being: the tax in it becomes reclaimable. So the cost that
 * belongs in a margin depends on the day, exactly as the price does.
 */
export function costToUs(billedHalalas: number, costVatBps: number, rule: VatRule): number {
  if (!rule.registered || costVatBps <= 0) {
    return billedHalalas;
  }
  // The bill includes the tax, so the net is the bill divided by one plus the rate.
  return Math.round((billedHalalas * 10_000) / (10_000 + costVatBps));
}

export async function listVatPeriods(db: Queryable): Promise<VatPeriod[]> {
  const { rows } = await db.query<{
    effective_from: string;
    registered: boolean;
    rate_bps: number;
    registration_number: string | null;
    note: string | null;
    set_by: string | null;
    set_at: Date;
  }>(
    `SELECT effective_from::text AS effective_from, registered, rate_bps,
            registration_number, note, set_by, set_at
     FROM vat_periods ORDER BY effective_from DESC`,
  );

  return rows.map((row) => ({
    effectiveFrom: row.effective_from,
    registered: row.registered,
    rateBps: Number(row.rate_bps),
    registrationNumber: row.registration_number,
    note: row.note,
    setBy: row.set_by,
    setAt: row.set_at,
  }));
}

export interface SetVatPeriodInput {
  /** The day the rule starts. */
  effectiveFrom: string;
  registered: boolean;
  rateBps: number;
  registrationNumber?: string | null;
  note?: string | null;
}

/**
 * Declares the rule from a date.
 *
 * Two refusals, and both are about not rewriting history. A period cannot start before the
 * newest one already recorded, because that would change what an invoice already issued says
 * it charged. And a registered period must carry the registration number, because an invoice
 * from a registered seller has to print it and discovering that at invoicing time is late.
 *
 * Setting a date in the future is the normal case: registration is known weeks before it
 * starts, and a platform that can only be told on the morning it happens will be told late.
 */
export async function setVatPeriod(
  db: Queryable,
  actor: OperatorIdentity,
  input: SetVatPeriodInput,
): Promise<void> {
  if (!operatorCan(actor.role, 'pricing')) {
    throw new NxError('NX-4031', { detail: 'this role does not change tax' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    throw new NxError('NX-4002', { detail: 'a period starts on a date' });
  }
  if (input.rateBps < 0 || input.rateBps > 10_000) {
    throw new NxError('NX-4002', { detail: 'a rate is between nothing and everything' });
  }
  const number = input.registrationNumber?.trim() ?? '';
  if (input.registered && !/^\d{15}$/.test(number)) {
    throw new NxError('NX-4002', {
      detail: 'a registered period needs the fifteen digit registration number',
    });
  }

  const { rows: existing } = await db.query<{ newest: string | null }>(
    `SELECT max(effective_from)::text AS newest FROM vat_periods`,
  );
  const newest = existing[0]?.newest ?? null;
  if (newest !== null && input.effectiveFrom < newest) {
    throw new NxError('NX-4003', {
      detail: 'a period cannot start before one already recorded, or invoices would change',
    });
  }

  await db.query(
    `INSERT INTO vat_periods (effective_from, registered, rate_bps, registration_number, note, set_by)
     VALUES ($1::date, $2, $3, $4, $5, $6)
     ON CONFLICT (effective_from) DO UPDATE
       SET registered = EXCLUDED.registered,
           rate_bps = EXCLUDED.rate_bps,
           registration_number = EXCLUDED.registration_number,
           note = EXCLUDED.note,
           set_by = EXCLUDED.set_by,
           set_at = now()`,
    [
      input.effectiveFrom,
      input.registered,
      input.rateBps,
      input.registered ? number : (number === '' ? null : number),
      input.note?.trim() === '' ? null : (input.note?.trim() ?? null),
      actor.displayName,
    ],
  );

  await recordOperatorAudit(db, {
    operatorId: actor.id,
    action: 'vat.period_set',
    target: `vat:${input.effectiveFrom}`,
    metadata: { registered: input.registered, rateBps: input.rateBps },
  });
}

/**
 * Every period, read once, as a function from a day to the rule that applied on it.
 *
 * A list of top ups spans months and each line is taxed by the rule of its own date. Asking
 * the database per line would be one query per row for a table that changes once a decade, and
 * resolving in memory is the same answer for the same reason `app.vat_on` gives it: the newest
 * period starting on or before the day.
 */
export async function vatResolver(db: Queryable): Promise<(when: Date) => VatRule> {
  const periods = await listVatPeriods(db);
  return (when: Date): VatRule => {
    const day = dayOf(when);
    const found = periods.find((period) => period.effectiveFrom <= day);
    return found === undefined
      ? UNREGISTERED
      : {
          registered: found.registered,
          rateBps: found.rateBps,
          registrationNumber: found.registrationNumber,
        };
  };
}
