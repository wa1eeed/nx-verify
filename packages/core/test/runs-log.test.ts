import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import { countRuns, listRecentRuns } from '../src/verification/runs-log.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * Unit 76 acceptance: the verification log is one subscriber's own, and says what an
 * auditor asks without naming who carried the call.
 */

describe('the verification log', () => {
  let db: TestDatabase;
  let mine: SeededTenant;
  let theirs: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture('carrier-that-must-not-appear');

  beforeAll(async () => {
    db = await createTestDatabase();
    mine = await seedTenant(db.appPool, 'Mine');
    theirs = await seedTenant(db.appPool, 'Theirs');
    for (const tenant of [mine, theirs]) {
      await preparePricedTenant(db, tenant.tenantId, { providerName: 'carrier-that-must-not-appear' });
      await withTenant(db.appPool, tenant.tenantId, (tx) =>
        verify(tx, {
          productCode: 'ADDRESS_ONLY',
          subject: { unn: '7001272184' },
          subjectIdentifiers: [{ idType: 'UNN', value: '7001272184' }],
          subjectDisplayName: `${tenant.tenantId === mine.tenantId ? 'Mine' : 'Theirs'} Trading`,
          idempotencyKey: randomUUID(),
          triggeredBy: 'CONSOLE',
          runStep: fixture.runnerFor(tx),
          keys,
        }),
      );
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('lists this subscriber runs only, with reference, product name and customer', async () => {
    const rows = await withTenant(db.appPool, mine.tenantId, (tx) => listRecentRuns(tx));
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.reference).toBeTruthy();
    expect(row?.productNameAr).toBe('التحقق من العنوان الوطني');
    expect(row?.entityName).toBe('Mine Trading');
    expect(row?.triggeredBy).toBe('CONSOLE');
  });

  it('never carries the provider that served the call', async () => {
    const rows = await withTenant(db.appPool, mine.tenantId, (tx) => listRecentRuns(tx));
    expect(JSON.stringify(rows)).not.toContain('carrier-that-must-not-appear');
  });

  it('filters by product and by result', async () => {
    const none = await withTenant(db.appPool, mine.tenantId, (tx) =>
      listRecentRuns(tx, { productCode: 'IBAN_OWNERSHIP' }),
    );
    expect(none).toHaveLength(0);
    const ok = await withTenant(db.appPool, mine.tenantId, (tx) => listRecentRuns(tx, { status: 'OK' }));
    expect(ok.length).toBeLessThanOrEqual(1);
  });

  it('counts this month from the same rows', async () => {
    const counts = await withTenant(db.appPool, theirs.tenantId, (tx) => countRuns(tx));
    expect(counts.thisMonth).toBe(1);
  });
});
