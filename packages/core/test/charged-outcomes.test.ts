import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { applyProductSeed } from '../../../packages/db/src/seed/products.js';
import { applyDefaultPriceSeed } from '../../../packages/db/src/seed/default-prices.js';
import { openPriceVersion } from '../src/billing/price-book.js';
import {
  NOT_CHARGED_AR,
  chargedOutcomes,
  chargedOutcomesSentenceAr,
  chargedShareAr,
} from '../src/billing/charged-outcomes.js';
import { createTestDatabase, seedTenant, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * What a subscriber is told about a run that is not a plain success (ADR-170).
 *
 * Both subscriber screens said «العمليات الفاشلة لا تُحسب» while the price row charged a
 * NOT_FOUND answer half the price and a cached answer all of it. These assert that the
 * wording follows the share stored for that subscriber's own price row: change the row and
 * the sentence changes with it, which a fixed sentence could never do.
 */

describe('what a run is charged when it is not a plain success', () => {
  let db: TestDatabase;
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    await withoutTenant(db.appPool, (tx) =>
      applyProductSeed(tx, undefined, { providerName: 'stub' }),
    );
    await applyDefaultPriceSeed(db.migratorPool);
    tenantId = (await seedTenant(db.appPool, 'شركة المثال للتجارة')).tenantId;
    otherTenantId = (await seedTenant(db.appPool, 'شركة أخرى')).tenantId;
  });

  afterAll(async () => {
    await db.close();
  });

  const sharesFor = async (tenant: string, codes: readonly string[]) =>
    withTenant(db.appPool, tenant, (tx) => chargedOutcomes(tx, codes));

  it('reads the shares of the list price in force', async () => {
    const shares = await sharesFor(tenantId, ['CR_FULL', 'NATIONAL_ADDRESS']);

    // The defaults of migration 0011, carried by the default list: half the price for an
    // authority that answered «no such subject», the whole of it for an answer from cache.
    expect(shares.get('CR_FULL')).toEqual({
      productCode: 'CR_FULL',
      notFoundPct: 0.5,
      cachedPct: 1,
    });
    expect(shares.get('NATIONAL_ADDRESS')?.notFoundPct).toBe(0.5);
  });

  it('leaves out a product with no price in force rather than assume a default', async () => {
    // A product of the catalogue that the default list does not price. A share nobody set is
    // a share no screen may print, so the map simply has no entry for it.
    const shares = await sharesFor(tenantId, ['KYB_COMPLETE']);
    expect(shares.has('KYB_COMPLETE')).toBe(false);
  });

  it('follows the price row of this subscriber, and of no other', async () => {
    await withTenant(db.appPool, tenantId, (tx) =>
      openPriceVersion(tx, {
        productCode: 'CR_FULL',
        unitPriceHalalas: 20_00,
        negativePct: 0,
        cachePct: 0.25,
      }),
    );

    const mine = await sharesFor(tenantId, ['CR_FULL']);
    expect(mine.get('CR_FULL')).toEqual({
      productCode: 'CR_FULL',
      notFoundPct: 0,
      cachedPct: 0.25,
    });

    // Rule 2: the row belongs to one tenant, and the other still reads the default list.
    const theirs = await sharesFor(otherTenantId, ['CR_FULL']);
    expect(theirs.get('CR_FULL')).toEqual({
      productCode: 'CR_FULL',
      notFoundPct: 0.5,
      cachedPct: 1,
    });
  });

  it('says what a share is rather than promising nothing is charged', () => {
    expect(chargedShareAr(0)).toBe('لا تُحسب');
    expect(chargedShareAr(1)).toBe('تُحسب كاملة');
    expect(chargedShareAr(0.5)).toBe('تُحسب بـ50% من السعر');
    expect(chargedShareAr(0.25)).toBe('تُحسب بـ25% من السعر');
  });

  it('builds the sentence from the shares, so a changed row changes the words', async () => {
    const before = chargedOutcomesSentenceAr({
      productCode: 'CR_FULL',
      notFoundPct: 0.5,
      cachedPct: 1,
    });
    expect(before).toContain('نتيجة «غير موجود» تُحسب بـ50% من السعر');
    expect(before).toContain('والنتيجة المخزّنة تُحسب كاملة');
    // The only two that earn nothing, and no price row can change that (compute.ts).
    expect(before).toContain(NOT_CHARGED_AR);

    const shares = await sharesFor(tenantId, ['CR_FULL']);
    const after = chargedOutcomesSentenceAr(
      shares.get('CR_FULL') ?? { productCode: 'CR_FULL', notFoundPct: 1, cachedPct: 1 },
    );
    expect(after).toContain('نتيجة «غير موجود» لا تُحسب');
    expect(after).toContain('والنتيجة المخزّنة تُحسب بـ25% من السعر');
    expect(after).not.toBe(before);
  });

  it('never promises that everything short of a success is free', async () => {
    const shares = await sharesFor(otherTenantId, ['CR_FULL']);
    const sentence = chargedOutcomesSentenceAr(
      shares.get('CR_FULL') ?? { productCode: 'CR_FULL', notFoundPct: 0, cachedPct: 0 },
    );
    expect(sentence).not.toContain('العمليات الفاشلة لا تُحسب');
  });
});
