import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { applyProductSeed } from '../../../packages/db/src/seed/products.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import {
  getFieldHistory,
  getVerificationHistory,
  recordAttestation,
} from '../src/repositories/attestations.js';

/**
 * Unit 69 acceptance: a new verification never erases the old one, and a person can see
 * that it did not.
 *
 * The immutability was always there. What was missing was any way to read it: the screen
 * showed the latest value and the database quietly held every value before it.
 */

describe('the history of one field', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let entityId: string;

  const runs: string[] = [];

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'History Tenant');
    entityId = tenant.entityId;
    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx));

    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      for (let index = 0; index < 3; index += 1) {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO verification_runs (tenant_id, product_code, entity_id, mode_at_execution,
                                          status, triggered_by, decision, created_at)
           VALUES ($1, 'KYB_COMPLETE', $2, 'BYOC', 'OK', 'API', 'PASS',
                   now() - make_interval(days => $3))
           RETURNING id`,
          [tx.tenantId, entityId, 30 - index * 10],
        );
        const runId = rows[0]?.id;
        if (!runId) {
          throw new Error('run insert returned nothing');
        }
        runs.push(runId);
      }

      // The registry status is read three times and changes once, in the middle.
      const statuses = ['ACTIVE', 'SUSPENDED', 'SUSPENDED'];
      for (const [index, status] of statuses.entries()) {
        await recordAttestation(tx, {
          entityId,
          fieldPath: 'cr.status',
          value: status,
          authority: 'Commercial Registry',
          observedAt: new Date(Date.now() - (30 - index * 10) * 86_400_000),
          runId: runs[index] ?? '',
          source: 'stub',
        });
      }

      // The capital is read once, on the first verification only.
      await recordAttestation(tx, {
        entityId,
        fieldPath: 'cr.capital',
        value: 500000,
        authority: 'Commercial Registry',
        observedAt: new Date(Date.now() - 30 * 86_400_000),
        runId: runs[0] ?? '',
        source: 'stub',
      });
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('keeps every value a field ever had, newest first', async () => {
    const history = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getFieldHistory(tx, entityId, 'cr.status'),
    );

    expect(history.map((entry) => entry.value)).toEqual(['SUSPENDED', 'SUSPENDED', 'ACTIVE']);
    // Exactly one is in force. The rest are what it replaced, and they are still here.
    expect(history.filter((entry) => entry.current)).toHaveLength(1);
    expect(history[0]?.current).toBe(true);
  });

  it('marks the reading that changed, and not the ones that confirmed', async () => {
    const history = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getFieldHistory(tx, entityId, 'cr.status'),
    );

    // Newest confirmed the middle one, the middle one changed from ACTIVE, and the oldest
    // had nothing before it to differ from.
    expect(history.map((entry) => entry.changed)).toEqual([false, true, false]);
  });

  it('groups verifications and says what each one actually told us', async () => {
    const timeline = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getVerificationHistory(tx, entityId),
    );

    expect(timeline).toHaveLength(3);
    // Newest first, the way a person reads a file.
    expect(timeline[0]?.runId).toBe(runs[2]);

    const first = timeline.find((run) => run.runId === runs[0]);
    expect(first?.fields.map((field) => field.kind).sort()).toEqual(['new', 'new']);

    const second = timeline.find((run) => run.runId === runs[1]);
    expect(second?.fields).toEqual([
      { fieldPath: 'cr.status', value: 'SUSPENDED', kind: 'changed' },
    ]);

    const third = timeline.find((run) => run.runId === runs[2]);
    // A field read again and found identical is the most common outcome there is. A
    // timeline that hides it looks like nothing happened.
    expect(third?.fields).toEqual([
      { fieldPath: 'cr.status', value: 'SUSPENDED', kind: 'confirmed' },
    ]);
  });

  it('does not report a change when only the type of the value differs', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO verification_runs (tenant_id, product_code, entity_id, mode_at_execution,
                                        status, triggered_by, created_at)
         VALUES ($1, 'KYB_COMPLETE', $2, 'BYOC', 'OK', 'API', now())
         RETURNING id`,
        [tx.tenantId, entityId],
      );
      await recordAttestation(tx, {
        entityId,
        fieldPath: 'cr.capital',
        value: 500000,
        authority: 'Commercial Registry',
        observedAt: new Date(),
        runId: rows[0]?.id ?? '',
        source: 'stub',
      });
    });

    const history = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getFieldHistory(tx, entityId, 'cr.capital'),
    );
    expect(history[0]?.changed).toBe(false);
  });

  it('keeps one workspace history invisible to another', async () => {
    const other = await seedTenant(db.appPool, 'Other History Tenant');
    const seen = await withTenant(db.appPool, other.tenantId, (tx) =>
      getFieldHistory(tx, entityId, 'cr.status'),
    );
    expect(seen).toHaveLength(0);
  });
});
