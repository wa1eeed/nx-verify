import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify, type VerifyActor, type VerifyInput } from '../src/verification/verify.js';
import { readAudit } from '../src/auth/audit.js';
import { createUser } from '../src/auth/users.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * A verification leaves a trace in the subscriber's own trail.
 *
 * It did not, on any path but one. The API route wrote the entry itself, so a subscriber
 * reading «من فعل ماذا في مساحة عملك» saw the calls made against their key and none of the
 * calls made from their own screens, from an onboarding case, from a batch or from a monitor
 * sweep. Every one of those spends their balance.
 *
 * The other half of this file is the part rule 4 makes non negotiable: the entry names the run
 * and what it cost, and nothing that identifies whoever was verified. Guard 05 walks every
 * column looking for an identifier, and an audit row is a column like any other.
 */

const UNN = '7001272184';

interface Over {
  idempotencyKey?: string;
  triggeredBy?: VerifyInput['triggeredBy'];
  requestedBy?: string;
  actor?: VerifyActor;
}

describe('the trail a verification leaves', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let analyst = '';
  const keys = testKeys();
  const fixture = providerFixture();

  const run = (over: Over = {}) =>
    withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn: UNN },
        subjectIdentifiers: [{ idType: 'UNN', value: UNN }],
        idempotencyKey: over.idempotencyKey ?? randomUUID(),
        triggeredBy: over.triggeredBy ?? 'API',
        ...(over.requestedBy === undefined ? {} : { requestedBy: over.requestedBy }),
        ...(over.actor === undefined ? {} : { actor: over.actor }),
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

  const trail = (action: string) =>
    withTenant(db.appPool, tenant.tenantId, (tx) => readAudit(tx, { action }));

  const entryFor = async (action: string, runId: string) =>
    (await trail(action)).find((row) => row.target === runId);

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Verify Trail Tenant');
    await preparePricedTenant(db, tenant.tenantId, { packageCode: 'PAYG' });
    analyst = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createUser(tx, { email: 'analyst@trail.test', displayName: 'محلل', role: 'ANALYST' }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('writes one entry per verification, naming the run, the service and what it cost', async () => {
    const result = await run();
    const entry = await entryFor('verification.created', result.runId);

    expect(entry).toBeDefined();
    expect(entry?.metadata).toMatchObject({
      product: 'ADDRESS_ONLY',
      status: result.status,
      triggered_by: 'API',
      billed_halalas: result.billing.amount,
    });
    // The whole reason for the entry: money left the wallet.
    expect(result.billing.amount).toBeGreaterThan(0);
  });

  it('writes nothing that identifies who was verified', async () => {
    const result = await run();
    const entry = await entryFor('verification.created', result.runId);

    // Rule 4 has no exception for an audit row, and the unified number is exactly the value a
    // reader of a trail must not be able to lift out of it.
    expect(JSON.stringify(entry?.metadata)).not.toContain(UNN);
    expect(entry?.target).toBe(result.runId);
    expect(entry?.target).not.toContain(UNN);
  });

  it('says a replay was a replay, so one charge does not read as two calls', async () => {
    const key = randomUUID();
    const first = await run({ idempotencyKey: key });
    const second = await run({ idempotencyKey: key });

    expect(second.replayed).toBe(true);
    expect(second.runId).toBe(first.runId);

    expect(
      (await trail('verification.replayed')).filter((row) => row.target === first.runId),
    ).toHaveLength(1);
    // And the first request is still the only one recorded as a verification: the same key
    // bought one run, and the trail says so rather than showing two of them.
    expect(
      (await trail('verification.created')).filter((row) => row.target === first.runId),
    ).toHaveLength(1);
  });

  it('names the person who pressed the button on a console run', async () => {
    const result = await run({ triggeredBy: 'CONSOLE', requestedBy: analyst });
    const entry = await entryFor('verification.created', result.runId);

    expect(entry?.actorType).toBe('USER');
    expect(entry?.actorId).toBe(analyst);
  });

  it('names the system for a sweep nobody pressed a button for', async () => {
    const result = await run({ triggeredBy: 'MONITOR' });
    const entry = await entryFor('verification.created', result.runId);

    // Not the person who created the schedule months ago: they did not perform this act.
    expect(entry?.actorType).toBe('SYSTEM');
    expect(entry?.actorId).toBe('monitor');
  });

  it('takes the actor the caller supplies, which is what the API layer knows', async () => {
    const keyId = randomUUID();
    const result = await run({
      actor: { actorType: 'API_KEY', actorId: keyId, ip: '203.0.113.9', requestId: 'req-verify-1' },
    });
    const entry = await entryFor('verification.created', result.runId);

    expect(entry?.actorType).toBe('API_KEY');
    expect(entry?.actorId).toBe(keyId);
    expect(entry?.requestId).toBe('req-verify-1');
    expect(entry?.ip).toBe('203.0.113.9');
  });
});
