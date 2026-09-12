import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant } from '../../../test/helpers/billing.js';
import { getWallet } from '../src/billing/wallet.js';
import { getRun } from '../src/orchestration/run-recorder.js';
import { recordInboundEvent } from '../src/webhooks/inbound.js';
import { listOpenWaits, matchWaits } from '../src/verification/waits.js';
import { abandonRun, resumeRun, verify } from '../src/verification/verify.js';
import type { StepRunner } from '../src/orchestration/executor.js';

/**
 * Unit 61 acceptance: a run whose answer comes later is charged once, when it comes.
 *
 * The property under test is not that resuming works. It is that an asynchronous run and
 * a synchronous one cost the same: a customer must not pay twice because the answer
 * arrived in two parts, and must not be charged at all for an answer that never came.
 */

const CORRELATION = 'lean-entity-6f21a0';
const KEYS = testKeys();

/** First call takes the request and leaves; second call answers. */
function twoPhaseRunner(): { runner: StepRunner; answer: () => void } {
  let answered = false;
  const runner: StepRunner = async (step) => {
    if (!answered) {
      return {
        outcome: 'AWAITING' as const,
        authority: null,
        data: null,
        latencyMs: 4,
        correlation: CORRELATION,
      };
    }
    return {
      outcome: 'OK' as const,
      authority: 'Commercial Registry',
      // The fields this product's map actually declares, so the profile gains something
      // and the score has something to be about.
      data: { city: 'الرياض', district: 'العليا', building_number: '2743' },
      latencyMs: 6,
      providerUsed: step.provider,
    };
  };
  return {
    runner,
    answer: () => {
      answered = true;
    },
  };
}

describe('a run that waits for the provider', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Awaiting Tenant');
    await preparePricedTenant(db, tenant.tenantId, { packageCode: 'PAYG' });
    await db.operatorPool.query(
      `INSERT INTO provider_catalog (code, name_ar, name_en, endpoints)
       VALUES ('stub', 'محاكاة', 'Stub', '{cr/basic}')
       ON CONFLICT (code) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('charges nothing while it waits, and once when it finishes', async () => {
    const { runner, answer } = twoPhaseRunner();

    // What the same product costs when the provider answers on the call. The point of
    // the test is that waiting changes nothing about the price, so the figure is measured
    // rather than written down here: a constant would still pass if both paths were wrong.
    const beforeDirect = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    const direct = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn: '7000000022' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7000000022' }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: async () => ({
          outcome: 'OK' as const,
          authority: 'Commercial Registry',
          data: { city: 'جدة', district: 'الروضة', building_number: '1100' },
          latencyMs: 3,
        }),
        keys: KEYS,
      }),
    );
    const afterDirect = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    const synchronousCost = beforeDirect.balance - afterDirect.balance;
    expect(synchronousCost).toBeGreaterThan(0);
    expect(direct.billing.amount).toBe(synchronousCost);

    const before = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    const started = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn: '7001272184' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7001272184' }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: runner,
        keys: KEYS,
        environment: 'sandbox',
      }),
    );

    expect(started.status).toBe('AWAITING');
    // A reference exists from the first moment: the customer has something to quote
    // while they wait, which is the difference between waiting and being ignored.
    expect(started.reference).toMatch(/^VRF-/);
    expect(started.billing.amount).toBe(0);

    const whileWaiting = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    // Nothing reserved and nothing spent. The hold is released, not carried.
    expect(whileWaiting.balance).toBe(before.balance);
    expect(whileWaiting.held).toBe(0);

    const open = await withTenant(db.appPool, tenant.tenantId, (tx) => listOpenWaits(tx));
    expect(open).toHaveLength(1);

    // The provider calls back. The delivery lands with no tenant, exactly as it does in
    // production, and is matched from inside the tenant's own scope.
    await recordInboundEvent(db.appPool, {
      target: {
        provider: 'stub',
        environment: 'sandbox',
        secretRef: 'kms://providers/stub/webhook',
        header: 'x-nx-provider-signature',
        algorithm: 'sha256',
      },
      body: Buffer.from(`{"id":"evt_wait","type":"entity.data.refresh.updated"}`, 'utf8'),
      parsed: {
        id: 'evt_wait',
        type: 'entity.data.refresh.updated',
        payload: { entity_id: CORRELATION, status: 'FINISHED' },
      },
    });

    answer();

    const finished = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const matched = await matchWaits(tx);
      expect(matched).toHaveLength(1);
      const first = matched[0];
      if (!first) {
        throw new Error('the delivery matched no wait');
      }
      return resumeRun(tx, { waitId: first.waitId, runStep: runner, keys: KEYS });
    });

    expect(finished?.status).toBe('OK');
    expect(finished?.runId).toBe(started.runId);
    // The same run, not a second one. A second run would be a second charge and a second
    // line on the statement for one verification.
    expect(finished?.reference).toBe(started.reference);
    // Waiting costs the same as not waiting, and costs it once.
    expect(finished?.billing.amount).toBe(synchronousCost);

    const after = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    expect(before.balance - after.balance).toBe(synchronousCost);
    expect(after.held).toBe(0);
  });

  it('leaves a score behind, so a list of customers can be scanned', async () => {
    // Computed on every run rather than only when a monitor happens to sweep. A column
    // that says "no score" for every row because nothing ever wrote one is a column that
    // should not be there.
    const rows = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const result = await tx.query<{ score: number }>(`SELECT score FROM entity_scores`);
      return result.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.score).toBeGreaterThan(0);
  });

  it('leaves no delivery to be matched twice', async () => {
    const again = await withTenant(db.appPool, tenant.tenantId, (tx) => matchWaits(tx));
    expect(again).toHaveLength(0);
  });

  it('closes a run the provider never answered, and bills nobody for it', async () => {
    const { runner } = twoPhaseRunner();

    const started = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn: '7000000010' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7000000010' }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: runner,
        keys: KEYS,
        environment: 'sandbox',
        // Already past by the time the sweep looks at it.
        awaitTtlSeconds: -1,
      }),
    );
    expect(started.status).toBe('AWAITING');

    const before = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    const closed = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const { expireWaits } = await import('../src/verification/waits.js');
      const runs = await expireWaits(tx);
      for (const runId of runs) {
        await abandonRun(tx, runId);
      }
      return getRun(tx, started.runId);
    });

    expect(closed?.status).toBe('ERROR');
    const after = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    expect(after.balance).toBe(before.balance);
  });

  it('keeps a sandbox delivery away from a production run', async () => {
    const { runner } = twoPhaseRunner();

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn: '7000000011' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7000000011' }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: runner,
        keys: KEYS,
        // The run belongs to production.
        environment: 'live',
      }),
    );

    // The same handle, delivered to the sandbox address.
    await recordInboundEvent(db.appPool, {
      target: {
        provider: 'stub',
        environment: 'sandbox',
        secretRef: 'kms://providers/stub/webhook',
        header: 'x-nx-provider-signature',
        algorithm: 'sha256',
      },
      body: Buffer.from('{"id":"evt_wrong_env"}', 'utf8'),
      parsed: { id: 'evt_wrong_env', payload: { entity_id: CORRELATION } },
    });

    const matched = await withTenant(db.appPool, tenant.tenantId, (tx) => matchWaits(tx));
    // A test delivery must never finish a real verification.
    expect(matched).toHaveLength(0);
  });
});
