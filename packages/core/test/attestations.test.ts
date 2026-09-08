import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { getAttestationTimeline, recordAttestation } from '../src/repositories/attestations.js';
import { getEntityProfile } from '../src/repositories/profile.js';

/** Unit 1 acceptance: writing an attestation and reading the profile both work. */

const HOUR = 60 * 60 * 1000;

describe('recording attestations and reading the profile', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Attestation Tenant');
  });

  afterAll(async () => {
    await db.close();
  });

  const write = (
    fieldPath: string,
    value: unknown,
    observedAt: Date,
    validUntil: Date | null = null,
  ) =>
    withTenant(db.appPool, tenant.tenantId, (tx) =>
      recordAttestation(tx, {
        entityId: tenant.entityId,
        fieldPath,
        value,
        source: 'provider.stub',
        authority: 'Commercial Registry',
        runId: randomUUID(),
        observedAt,
        validUntil,
      }),
    );

  it('reports the first observation of a field', async () => {
    const result = await write('cr.status', { status: 'ACTIVE' }, new Date());
    expect(result.firstObservation).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.previousAttestationId).toBeNull();
  });

  it('inserts a new row on re-verification even when nothing changed', async () => {
    const first = await write('cr.core', { capital: 100 }, new Date(Date.now() - HOUR));
    const second = await write('cr.core', { capital: 100 }, new Date());

    expect(second.changed).toBe(false);
    expect(second.previousAttestationId).toBe(first.attestationId);
    expect(second.attestationId).not.toBe(first.attestationId);

    const timeline = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getAttestationTimeline(tx, tenant.entityId, { fieldPath: 'cr.core' }),
    );
    // Two rows, not one updated row. This is what separates "last confirmed" from
    // "last changed".
    expect(timeline).toHaveLength(2);
    expect(
      timeline.find((entry) => entry.attestationId === first.attestationId)?.supersededBy,
    ).toBe(second.attestationId);
  });

  it('reports a change when the value differs', async () => {
    await write('cr.status', { status: 'ACTIVE' }, new Date(Date.now() - HOUR));
    const changed = await write('cr.status', { status: 'SUSPENDED' }, new Date());
    expect(changed.changed).toBe(true);
  });

  it('treats a value with reordered keys as unchanged', async () => {
    await write('manager.core', { name: 'A', role: 'B' }, new Date(Date.now() - HOUR));
    const again = await write('manager.core', { role: 'B', name: 'A' }, new Date());
    expect(again.changed).toBe(false);
  });

  it('projects only the live attestation per field into the profile', async () => {
    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, tenant.entityId),
    );

    const paths = profile.map((field) => field.fieldPath);
    expect(new Set(paths).size).toBe(paths.length);
    expect(profile.find((field) => field.fieldPath === 'cr.status')?.value).toEqual({
      status: 'SUSPENDED',
    });
  });

  it('carries an authority and an observed_at on every projected field', async () => {
    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, tenant.entityId),
    );

    expect(profile.length).toBeGreaterThan(0);
    for (const field of profile) {
      // Rule 6: a field without these two has no place in the platform.
      expect(field.authority).toBeTruthy();
      expect(field.observedAt).toBeInstanceOf(Date);
    }
  });

  it('computes freshness from valid_until alone, with no call and no cost', async () => {
    const past = new Date(Date.now() - 30 * 24 * HOUR);
    const soon = new Date(Date.now() + 3 * 24 * HOUR);
    const far = new Date(Date.now() + 300 * 24 * HOUR);

    await write('address.national', { city: 'Riyadh' }, new Date(), past);
    await write('iban.ownership', { matched: true }, new Date(), soon);
    await write('property.deed', { number: 'X' }, new Date(), far);

    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, tenant.entityId),
    );
    const byPath = new Map(profile.map((field) => [field.fieldPath, field.freshness]));

    expect(byPath.get('address.national')).toBe('expired');
    expect(byPath.get('iban.ownership')).toBe('expiring');
    expect(byPath.get('property.deed')).toBe('fresh');
    expect(byPath.get('cr.status')).toBe('permanent');
  });

  it('never exposes the provider through the profile or the timeline', async () => {
    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, tenant.entityId),
    );
    const timeline = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getAttestationTimeline(tx, tenant.entityId),
    );

    // Rule 5. The stored source is 'provider.stub' and it must not survive the read path.
    expect(JSON.stringify({ profile, timeline })).not.toContain('provider.stub');
  });
});
