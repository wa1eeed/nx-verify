import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../packages/db/src/client.js';
import { verify } from '../../packages/core/src/verification/verify.js';
import { getLedger, getWallet } from '../../packages/core/src/billing/wallet.js';
import { getRun } from '../../packages/core/src/orchestration/run-recorder.js';
import { computeBilling } from '../../packages/core/src/billing/compute.js';
import { resolvePrice } from '../../packages/core/src/billing/price-book.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../helpers/db.js';
import { preparePricedTenant, providerFixture } from '../helpers/billing.js';
import type { StepOutcome } from '../../packages/core/src/orchestration/executor.js';

/**
 * Guard 04: a SKIPPED step is billed zero.
 *
 * Charging for a step that never ran is the fastest route to a billing dispute with an
 * enterprise customer, and it is the kind of error that destroys trust in every other
 * number on the invoice at the same time.
 *
 * Three layers have to agree, and each is checked here: the apportionment never assigns
 * an amount to a skipped step, the stored run_steps row carries zero and billable false,
 * and the ledger charge equals the sum of the steps that actually ran.
 */

function step(
  overrides: Partial<StepOutcome> & { stepKey: string; status: StepOutcome['status'] },
): StepOutcome {
  return {
    provider: 'stub',
    endpoint: 'business_verification',
    authority: 'Commercial Registry',
    data: null,
    latencyMs: 5,
    servedFromCache: false,
    billable: overrides.status === 'OK',
    stepWeight: 1,
    required: false,
    ...overrides,
  };
}

describe('guard 04: a skipped step is billed zero', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Guard 04 Tenant');
    await preparePricedTenant(db, tenant.tenantId);
  });

  afterAll(async () => {
    await db.close();
  });

  it('assigns nothing to a skipped or errored step', async () => {
    const price = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolvePrice(tx, 'KYB_COMPLETE'),
    );

    const breakdown = computeBilling(
      [
        step({ stepKey: 'cr_full', status: 'OK', stepWeight: 40 }),
        step({ stepKey: 'address', status: 'OK', stepWeight: 15 }),
        step({ stepKey: 'aoa', status: 'ERROR', stepWeight: 15, errorCode: 'NETWORK' }),
        step({
          stepKey: 'manager_auth',
          status: 'SKIPPED',
          stepWeight: 20,
          skippedBecause: 'depends_on:aoa',
        }),
        step({ stepKey: 'ubo', status: 'OK', stepWeight: 10 }),
      ],
      price,
    );

    const byKey = new Map(breakdown.steps.map((entry) => [entry.stepKey, entry]));
    expect(byKey.get('manager_auth')?.amount).toBe(0);
    expect(byKey.get('manager_auth')?.billable).toBe(false);
    expect(byKey.get('aoa')?.amount).toBe(0);

    // 65 of 100 weight ran, so 65 percent of the 44.00 price.
    expect(breakdown.total).toBe(28_60);
    expect(breakdown.total).toBeLessThan(price.unitPrice);
  });

  it('bills a NOT_FOUND at the negative rate, not at zero and not in full', async () => {
    const price = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolvePrice(tx, 'ADDRESS_ONLY'),
    );
    const breakdown = computeBilling(
      [step({ stepKey: 'address', status: 'NOT_FOUND', stepWeight: 1 })],
      price,
    );

    // The authority answered. That is a result, and it costs us a query.
    expect(breakdown.total).toBe(4_00);
  });

  it('stores zero and billable false on the skipped run_steps row', async () => {
    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'KYB_COMPLETE',
        // This subject makes the registry answer with a thin payload, so later steps
        // find nothing and the run comes back partial.
        subject: { unn: '7000000003' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7000000003' }],
        idempotencyKey: `guard04-${randomUUID()}`,
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

    const stored = await withTenant(db.appPool, tenant.tenantId, (tx) => getRun(tx, result.runId));
    for (const runStep of stored?.steps ?? []) {
      if (runStep.status === 'SKIPPED' || runStep.status === 'ERROR') {
        expect(runStep.billedAmount, runStep.stepKey).toBe(0);
        expect(runStep.billable, runStep.stepKey).toBe(false);
      }
    }
  });

  it('refuses at the database level to bill a skipped step', async () => {
    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn: '7001272184' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7001272184' }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

    // Not a policy in application code. The table refuses it.
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query(
          `INSERT INTO run_steps (tenant_id, run_id, step_key, provider, endpoint, status,
                                  billable, billed_amount)
           VALUES ($1, $2, 'phantom', 'stub', 'business_verification', 'SKIPPED', true, 5.00)`,
          [tenant.tenantId, result.runId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('charges the wallet exactly what the steps that ran came to', async () => {
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'KYB_COMPLETE',
        subject: { unn: '7000000003' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7000000099' }],
        idempotencyKey: `guard04-charge-${randomUUID()}`,
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

    const after = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    const stepTotal = (result.breakdown?.steps ?? []).reduce((sum, entry) => sum + entry.amount, 0);

    expect(result.billing.amount).toBe(stepTotal);
    expect(before.balance - after.balance).toBe(stepTotal);
    expect(after.held).toBe(0);
  });

  it('releases the reservation and charges nothing when every step fails', async () => {
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        // This subject makes every call fail at the network level.
        productCode: 'ADDRESS_ONLY',
        subject: { unn: '7000000001' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7000000001' }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

    const after = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    expect(result.status).toBe('ERROR');
    // A technical error is never billed.
    expect(result.billing.amount).toBe(0);
    expect(after.balance).toBe(before.balance);
    expect(after.held).toBe(0);

    const ledger = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getLedger(tx, { runId: result.runId }),
    );
    expect(ledger.map((entry) => entry.reason)).toEqual(['RELEASE']);
  });
});
