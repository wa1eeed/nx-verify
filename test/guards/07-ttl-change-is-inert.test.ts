import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../packages/db/src/client.js';
import { recordAttestation } from '../../packages/core/src/repositories/attestations.js';
import { getEntityProfile } from '../../packages/core/src/repositories/profile.js';
import {
  clearTenantTtl,
  listFreshnessPolicy,
  previewTtlChange,
  setTenantTtl,
} from '../../packages/core/src/repositories/freshness.js';
import {
  createTestDatabase,
  seedEntity,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../helpers/db.js';

/**
 * Guard 07: changing a TTL touches no attestation.
 *
 * ADR-007. Freshness is arithmetic. The field ages on its own, the calculation is
 * redone, and the facts are left exactly as they were.
 *
 * The proof is a full snapshot of every attestation row before and after the edit,
 * compared byte for byte. Asserting on a count or on updated_at would miss a rewrite
 * that happened to preserve them.
 */

const DAY = 24 * 60 * 60 * 1000;

async function snapshotAttestations(db: TestDatabase, tenantId: string): Promise<string> {
  return withTenant(db.migratorPool, tenantId, async (tx) => {
    const { rows } = await tx.query<{ snapshot: string }>(
      `SELECT COALESCE(string_agg(row_to_json(a)::text, '|' ORDER BY a.id), '') AS snapshot
       FROM attestations a`,
    );
    return rows[0]?.snapshot ?? '';
  });
}

describe('guard 07: a TTL change is inert', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Guard 07 Tenant');

    // Observed 40 days ago. Fresh under the 90 day default for cr.core, expired under 30.
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      recordAttestation(tx, {
        entityId: tenant.entityId,
        fieldPath: 'cr.core',
        value: { capital: 500000 },
        source: 'provider.stub',
        authority: 'Commercial Registry',
        runId: randomUUID(),
        observedAt: new Date(Date.now() - 40 * DAY),
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('leaves every attestation row byte identical after a TTL edit', async () => {
    const before = await snapshotAttestations(db, tenant.tenantId);

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      setTenantTtl(tx, { fieldPath: 'cr.core', ttlDays: 30, weight: 26 }),
    );

    const after = await snapshotAttestations(db, tenant.tenantId);
    expect(after).toBe(before);
    expect(after).not.toBe('');
  });

  it('changes the computed freshness with no write at all', async () => {
    const freshnessNow = async (): Promise<string | undefined> => {
      const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
        getEntityProfile(tx, tenant.entityId),
      );
      return profile.find((field) => field.fieldPath === 'cr.core')?.freshness;
    };

    // The 30 day override from the previous test is in force.
    expect(await freshnessNow()).toBe('expired');

    const before = await snapshotAttestations(db, tenant.tenantId);
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      setTenantTtl(tx, { fieldPath: 'cr.core', ttlDays: 365, weight: 26 }),
    );
    expect(await freshnessNow()).toBe('fresh');
    expect(await snapshotAttestations(db, tenant.tenantId)).toBe(before);

    await withTenant(db.appPool, tenant.tenantId, (tx) => clearTenantTtl(tx, 'cr.core'));
    // Back to the 90 day system default, and 40 days old is fresh under it.
    expect(await freshnessNow()).toBe('fresh');
    expect(await snapshotAttestations(db, tenant.tenantId)).toBe(before);
  });

  it('does not let one tenant change the default another tenant inherits', async () => {
    const other = await seedTenant(db.appPool, 'Guard 07 Other Tenant');

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      setTenantTtl(tx, { fieldPath: 'cr.status', ttlDays: 1, weight: 20 }),
    );

    const otherPolicy = await withTenant(db.appPool, other.tenantId, (tx) =>
      listFreshnessPolicy(tx),
    );
    const crStatus = otherPolicy.find((row) => row.fieldPath === 'cr.status');
    expect(crStatus?.ttlDays).toBe(7);
    expect(crStatus?.source).toBe('system');
  });

  it('refuses an attempt to write a system default row', async () => {
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query(
          'INSERT INTO freshness_policy (tenant_id, field_path, ttl_days, weight) VALUES (NULL, $1, $2, $3)',
          ['cr.core', 1, 1],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('previews the impact of an edit before it is saved, and writes nothing', async () => {
    const previewTenant = await seedTenant(db.appPool, 'Guard 07 Preview Tenant');
    const entities = [previewTenant.entityId];
    for (let index = 0; index < 3; index += 1) {
      entities.push(await seedEntity(db.appPool, previewTenant.tenantId, 'BUSINESS'));
    }

    await withTenant(db.appPool, previewTenant.tenantId, async (tx) => {
      for (const entityId of entities) {
        await recordAttestation(tx, {
          entityId,
          fieldPath: 'address.national',
          value: { city: 'Riyadh' },
          source: 'provider.stub',
          authority: 'National Address',
          runId: randomUUID(),
          observedAt: new Date(Date.now() - 20 * DAY),
        });
      }
    });

    const before = await snapshotAttestations(db, previewTenant.tenantId);

    const preview = await withTenant(db.appPool, previewTenant.tenantId, (tx) =>
      previewTtlChange(tx, 'address.national', 10),
    );

    // Twenty days old, fresh under the 30 day default, expired under a 10 day TTL.
    expect(preview.currentTtlDays).toBe(30);
    expect(preview.proposedTtlDays).toBe(10);
    expect(preview.before.fresh).toBe(4);
    expect(preview.after.expired).toBe(4);
    expect(preview.newlyExpired).toBe(4);

    // A preview is a question, not a change.
    expect(await snapshotAttestations(db, previewTenant.tenantId)).toBe(before);
    const policy = await withTenant(db.appPool, previewTenant.tenantId, (tx) =>
      listFreshnessPolicy(tx),
    );
    expect(policy.find((row) => row.fieldPath === 'address.national')?.source).toBe('system');
  });

  it('keeps a real expiry from the authority ahead of any TTL', async () => {
    const docTenant = await seedTenant(db.appPool, 'Guard 07 Document Tenant');
    const expiry = new Date(Date.now() + 5 * DAY);

    await withTenant(db.appPool, docTenant.tenantId, (tx) =>
      recordAttestation(tx, {
        entityId: docTenant.entityId,
        fieldPath: 'freelance.document',
        value: { number: 'FL-1' },
        source: 'provider.stub',
        authority: 'Ministry of Human Resources',
        runId: randomUUID(),
        observedAt: new Date(),
        validUntil: expiry,
      }),
    );

    // No TTL exists for freelance.document, and none is needed: the document carries its
    // own expiry, which is five days away, so the field is expiring rather than fresh.
    const profile = await withTenant(db.appPool, docTenant.tenantId, (tx) =>
      getEntityProfile(tx, docTenant.entityId),
    );
    const field = profile.find((entry) => entry.fieldPath === 'freelance.document');
    expect(field?.freshness).toBe('expiring');
    expect(field?.ttlDays).toBeNull();
  });
});
