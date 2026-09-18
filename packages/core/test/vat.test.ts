import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  UNREGISTERED,
  costToUs,
  listVatPeriods,
  setVatPeriod,
  vatInForce,
  vatResolver,
  withVat,
} from '../src/billing/vat.js';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';
import type { OperatorIdentity } from '../src/operators/accounts.js';

/**
 * Value added tax, as a period rather than a switch (ADR-157).
 *
 * The property that matters is that an invoice does not change. Everything else here follows
 * from it: a rule is declared from a date, a calculation takes a date, and a period cannot be
 * inserted before one already recorded.
 */

const OWNER: OperatorIdentity = { id: 'op-1', displayName: 'مالك', role: 'OWNER' };
const PRICER: OperatorIdentity = { id: 'op-2', displayName: 'تسعير', role: 'PRICING' };
const SUPPORT: OperatorIdentity = { id: 'op-3', displayName: 'دعم', role: 'SUPPORT' };

const NUMBER = '300000000000003';

describe('value added tax', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('starts unregistered, which is what the platform is today', async () => {
    const rule = await vatInForce(db.operatorPool, new Date('2026-01-01T00:00:00Z'));
    expect(rule.registered).toBe(false);
    // Nothing is due, and that is not the same as a rate of zero: an invoice from an
    // unregistered seller carries no tax line at all.
    expect(withVat(100_00, rule).vatHalalas).toBe(0);
    expect(withVat(100_00, rule).grossHalalas).toBe(100_00);
  });

  it('adds the tax only from the day registration starts', async () => {
    await setVatPeriod(db.operatorPool, OWNER, {
      effectiveFrom: '2026-04-01',
      registered: true,
      rateBps: 1500,
      registrationNumber: NUMBER,
    });

    const march = await vatInForce(db.operatorPool, new Date('2026-03-31T23:00:00Z'));
    const april = await vatInForce(db.operatorPool, new Date('2026-04-01T00:00:00Z'));

    expect(march.registered).toBe(false);
    expect(april.registered).toBe(true);
    // The whole argument for a period: an invoice issued in March is still a March invoice
    // when it is reprinted in May.
    expect(withVat(100_00, march).grossHalalas).toBe(100_00);
    expect(withVat(100_00, april).grossHalalas).toBe(115_00);
    expect(april.registrationNumber).toBe(NUMBER);
  });

  it('refuses a period that starts before one already recorded', async () => {
    await expect(
      setVatPeriod(db.operatorPool, OWNER, {
        effectiveFrom: '2026-02-01',
        registered: true,
        rateBps: 1500,
        registrationNumber: NUMBER,
      }),
    ).rejects.toMatchObject({ code: 'NX-4003' });
  });

  it('refuses a registered period with no registration number', async () => {
    await expect(
      setVatPeriod(db.operatorPool, OWNER, {
        effectiveFrom: '2027-01-01',
        registered: true,
        rateBps: 1500,
      }),
    ).rejects.toMatchObject({ code: 'NX-4002' });
    await expect(
      setVatPeriod(db.operatorPool, OWNER, {
        effectiveFrom: '2027-01-01',
        registered: true,
        rateBps: 1500,
        registrationNumber: '123',
      }),
    ).rejects.toMatchObject({ code: 'NX-4002' });
  });

  it('lets only the roles that set prices set tax', async () => {
    await expect(
      setVatPeriod(db.operatorPool, SUPPORT, {
        effectiveFrom: '2028-01-01',
        registered: false,
        rateBps: 0,
      }),
    ).rejects.toMatchObject({ code: 'NX-4031' });

    await setVatPeriod(db.operatorPool, PRICER, {
      effectiveFrom: '2028-01-01',
      registered: false,
      rateBps: 1500,
      note: 'انتهاء التسجيل',
    });
    const periods = await listVatPeriods(db.operatorPool);
    expect(periods[0]?.effectiveFrom).toBe('2028-01-01');
    expect(periods[0]?.setBy).toBe('تسعير');
  });

  it('resolves every date in one read, the way a list of invoices needs', async () => {
    const ruleFor = await vatResolver(db.operatorPool);
    expect(ruleFor(new Date('2026-01-15T00:00:00Z')).registered).toBe(false);
    expect(ruleFor(new Date('2026-06-15T00:00:00Z')).registered).toBe(true);
    // And after the registration ends again, which is a real thing that happens.
    expect(ruleFor(new Date('2028-06-15T00:00:00Z')).registered).toBe(false);
  });

  it('turns a provider bill into a cost only once the tax is reclaimable', () => {
    const registered = { registered: true, rateBps: 1500, registrationNumber: NUMBER };
    // Unregistered: their tax is our cost, entire. This is today.
    expect(costToUs(11_50, 1500, UNREGISTERED)).toBe(11_50);
    // Registered: we reclaim it, so the same bill costs us less and the margin widens.
    expect(costToUs(11_50, 1500, registered)).toBe(10_00);
    // A provider who charges no tax is unaffected either way.
    expect(costToUs(10_00, 0, registered)).toBe(10_00);
  });

  it('keeps the price list out of it', async () => {
    // Nothing in price_book changes on the day we register. Prices are stored without tax and
    // always were, which is what makes this one rule rather than a rewrite of every price.
    const { rows } = await db.operatorPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM price_book WHERE unit_price <= 0`,
    );
    expect(rows[0]?.count).toBe('0');
  });
});
