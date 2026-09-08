import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../../../packages/core/src/verification/verify.js';
import {
  cancelBatch,
  confirmBatch,
  createBatch,
  getBatch,
  previewBatch,
} from '../../../packages/core/src/batches/batches.js';
import { getWallet } from '../../../packages/core/src/billing/wallet.js';
import { readAudit } from '../../../packages/core/src/auth/audit.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';
import { runBatchItems } from '../src/jobs/batches.js';

/**
 * Smart batches, and the promise that makes them safe to offer.
 */

const OPERATOR = 'user:ops-1';

describe('smart batches', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Batch Tenant');
    await preparePricedTenant(db.appPool, tenant.tenantId, { balanceHalalas: 5_000_00 });

    // Three entities to select from.
    for (const unn of ['7008000001', '7008000002', '7008000003']) {
      await withTenant(db.appPool, tenant.tenantId, (tx) =>
        verify(tx, {
          productCode: 'ADDRESS_ONLY',
          subject: { unn },
          subjectIdentifiers: [{ idType: 'UNN', value: unn }],
          triggeredBy: 'API',
          modeAtExecution: 'BYOC',
          runStep: fixture.runnerFor(tx),
          keys,
        }),
      );
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('previews the count and the cost without writing anything', async () => {
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    const preview = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      previewBatch(tx, 'ADDRESS_ONLY', { entityType: 'BUSINESS' }),
    );

    // The tenant fixture seeds one business of its own, so this is the three verified
    // here plus that one.
    expect(preview.entities).toBe(4);
    expect(preview.unitPrice).toBe(8_00);
    expect(preview.estimatedCost).toBe(preview.entities * preview.unitPrice);
    expect(preview.exceedsBalance).toBe(false);

    const after = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    // A preview is a question, not a change.
    expect(after.balance).toBe(before.balance);
  });

  it('warns when the balance cannot cover the batch', async () => {
    const poor = await seedTenant(db.appPool, 'Poor Batch Tenant');
    await preparePricedTenant(db.appPool, poor.tenantId, { balanceHalalas: 1_00 });

    await withTenant(db.appPool, poor.tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn: '7008000009' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7008000009' }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    ).catch(() => undefined);

    const preview = await withTenant(db.appPool, poor.tenantId, (tx) =>
      previewBatch(tx, 'ADDRESS_ONLY', { entityType: 'BUSINESS' }),
    );
    expect(preview.exceedsBalance).toBe(true);
  });

  it('runs only what was confirmed, and refuses a stale estimate', async () => {
    const created = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createBatch(tx, {
        productCode: 'ADDRESS_ONLY',
        criteria: { entityType: 'BUSINESS' },
        createdBy: OPERATOR,
      }),
    );

    // Confirming against a different figure than the one shown is refused. A preview the
    // system does not hold itself to is decoration.
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        confirmBatch(tx, {
          batchId: created.batchId,
          confirmedBy: OPERATOR,
          acceptedCost: created.preview.estimatedCost + 1_00,
        }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4002' });

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      confirmBatch(tx, {
        batchId: created.batchId,
        confirmedBy: OPERATOR,
        acceptedCost: created.preview.estimatedCost,
      }),
    );

    const confirmed = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getBatch(tx, created.batchId),
    );
    expect(confirmed?.status).toBe('CONFIRMED');
    expect(confirmed?.confirmedBy).toBe(OPERATOR);
  });

  it('will not run a batch that was never confirmed', async () => {
    const created = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createBatch(tx, {
        productCode: 'ADDRESS_ONLY',
        criteria: { entityType: 'BUSINESS', limit: 1 },
        createdBy: OPERATOR,
      }),
    );

    const summaries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      runBatchItems(tx, { keys, runStep: fixture.runnerFor(tx) }),
    );

    expect(summaries.every((entry) => entry.batchId !== created.batchId)).toBe(true);
  });

  it('executes a confirmed batch and charges what it actually used', async () => {
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    const created = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createBatch(tx, {
        productCode: 'ADDRESS_ONLY',
        criteria: { entityType: 'BUSINESS', limit: 2 },
        createdBy: OPERATOR,
      }),
    );
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      confirmBatch(tx, {
        batchId: created.batchId,
        confirmedBy: OPERATOR,
        acceptedCost: created.preview.estimatedCost,
      }),
    );

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      runBatchItems(tx, { keys, runStep: fixture.runnerFor(tx) }),
    );

    const batch = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getBatch(tx, created.batchId),
    );
    const after = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    expect(batch?.status).toBe('DONE');
    expect(batch?.pending).toBe(0);
    expect(batch?.actualCost).toBe(before.balance - after.balance);
    // The estimate was a ceiling, and the charge is what actually ran.
    expect(batch?.actualCost).toBeLessThanOrEqual(batch?.estimatedCost ?? 0);
  });

  it('records who confirmed a batch and the figure they agreed to', async () => {
    const entries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      readAudit(tx, { action: 'batch.confirmed' }),
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.actorId).toBe(OPERATOR);
  });

  it('selects only entities whose knowledge is older than the given age', async () => {
    const stale = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      previewBatch(tx, 'ADDRESS_ONLY', {
        entityType: 'BUSINESS',
        fieldPath: 'address.national.city',
        olderThanDays: 3650,
      }),
    );
    // Everything was verified a moment ago, so nothing is ten years old.
    expect(stale.entities).toBe(0);
  });

  it('finds the entities missing a field, which is the completeness gap', async () => {
    const gap = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      previewBatch(tx, 'KYB_COMPLETE', {
        entityType: 'BUSINESS',
        missingField: 'manager.signing_authority',
      }),
    );

    // The customer's incentive and ours point the same way here.
    expect(gap.entities).toBeGreaterThan(0);
    expect(gap.estimatedCost).toBeGreaterThan(0);
  });

  it('can be cancelled before it runs', async () => {
    const created = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createBatch(tx, {
        productCode: 'ADDRESS_ONLY',
        criteria: { entityType: 'BUSINESS', limit: 1 },
        createdBy: OPERATOR,
      }),
    );

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      cancelBatch(tx, created.batchId, OPERATOR),
    );

    const batch = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getBatch(tx, created.batchId),
    );
    expect(batch?.status).toBe('CANCELLED');
  });

  it('keeps batches inside their tenant', async () => {
    const other = await seedTenant(db.appPool, 'Batch Other Tenant');
    const summaries = await withTenant(db.appPool, other.tenantId, (tx) =>
      runBatchItems(tx, { keys, runStep: fixture.runnerFor(tx) }),
    );
    expect(summaries).toEqual([]);
  });
});
