import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { applyProductSeed } from '../../../packages/db/src/seed/products.js';
import {
  InMemorySecretStore,
  ProviderRegistry,
  StubProvider,
  createProviderStepRunner,
  resolveCredential,
} from '../../../packages/providers/src/index.js';
import {
  createTestDatabase,
  insertAttestation,
  seedEntity,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { requireProduct } from '../src/products/catalog.js';
import { executeProduct } from '../src/orchestration/executor.js';
import { recordRun } from '../src/orchestration/run-recorder.js';
import { normaliseRun } from '../src/normalisation/normalise.js';
import { findEntitiesLinkedToMany, getRelations } from '../src/normalisation/network.js';
import { getEntityProfile } from '../src/repositories/profile.js';
import { resolveEntity } from '../src/repositories/entities.js';
import { invalidateSchemaCache } from '../src/products/input-validation.js';

/**
 * Unit 5 acceptance: a stub response produces attestations, entities and relations,
 * through step_field_map rows and no product specific code.
 */

const SECRET_REF = 'kms://tenants/test/providers/stub';

describe('normalisation turns a provider payload into our model', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();
  const registry = new ProviderRegistry().register(new StubProvider());
  const secrets = new InMemorySecretStore({ [SECRET_REF]: { apiKey: 'test-key' } });

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Normalisation Tenant');
    invalidateSchemaCache();
    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx));
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(
        `INSERT INTO tenant_provider_binding (tenant_id, provider, mode, credential_ref)
         VALUES ($1, 'stub', 'BYOC', $2)`,
        [tenant.tenantId, SECRET_REF],
      ),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  const verify = async (code: string, subject: Record<string, unknown>, entityId: string) =>
    withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const product = await requireProduct(tx, code);
      const runStep = createProviderStepRunner({
        registry,
        credentialFor: (provider) => resolveCredential(tx, secrets, provider),
      });
      const outcome = await executeProduct({ product, subject, runStep });
      const recorded = await recordRun(tx, {
        productCode: code,
        entityId,
        modeAtExecution: 'BYOC',
        status: outcome.status,
        latencyMs: outcome.latencyMs,
        triggeredBy: 'API',
        steps: outcome.steps,
      });
      const normalised = await normaliseRun(tx, keys, {
        productCode: code,
        subjectEntityId: entityId,
        runId: recorded.runId,
        steps: outcome.steps,
      });
      return { outcome, recorded, normalised };
    });

  it('writes attestations on the subject from SUBJECT mappings', async () => {
    const { entityId } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveEntity(tx, keys, {
        entityType: 'BUSINESS',
        identifiers: [{ idType: 'UNN', value: '7001272184' }],
        displayName: 'Example Trading',
      }),
    );

    await verify('KYB_COMPLETE', { unn: '7001272184' }, entityId);

    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, entityId),
    );
    const byPath = new Map(profile.map((field) => [field.fieldPath, field]));

    expect(byPath.get('cr.status')?.value).toBe('ACTIVE');
    expect(byPath.get('cr.core.capital')?.value).toBe(500000);
    expect(byPath.get('address.national.city')?.value).toBe('الرياض');
    // Rule 6: every projected field carries its authority and its timestamp.
    expect(byPath.get('cr.status')?.authority).toBe('Commercial Registry');
  });

  it('creates a secondary entity and a relation from an array mapping', async () => {
    const { entityId } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveEntity(tx, keys, {
        entityType: 'BUSINESS',
        identifiers: [{ idType: 'CR', value: '1010111222' }],
        displayName: 'Second Company',
      }),
    );

    const { normalised } = await verify('KYB_COMPLETE', { unn: '7001272184' }, entityId);

    const manager = normalised.entities.find((entry) => entry.role === 'MANAGER');
    expect(manager).toBeDefined();
    expect(normalised.relations.some((relation) => relation.relType === 'MANAGES')).toBe(true);

    const relations = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getRelations(tx, entityId),
    );
    // Two mappings name the same manager, from the articles of association and from the
    // permissions check. They resolve to one person and one relation, not two.
    expect(relations.map((edge) => edge.relType).sort()).toEqual(['MANAGES', 'OWNS']);
    // Every derived row points at the attestation that produced it.
    for (const edge of relations) {
      expect(edge.attestationId).toBeTruthy();
    }
  });

  it('resolves the same manager to one person across two companies', async () => {
    const companies: string[] = [];
    for (const cr of ['1010333444', '1010555666']) {
      const { entityId } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
        resolveEntity(tx, keys, {
          entityType: 'BUSINESS',
          identifiers: [{ idType: 'CR', value: cr }],
        }),
      );
      companies.push(entityId);
      await verify('KYB_COMPLETE', { unn: '7001272184' }, entityId);
    }

    const managers = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      findEntitiesLinkedToMany(tx, 'MANAGES', 3),
    );

    // The same national id in three companies is one person, not three. This is the
    // query that sells the platform.
    expect(managers).toHaveLength(1);
    expect(managers[0]?.linkedCount).toBeGreaterThanOrEqual(3);
    expect(managers[0]?.entityType).toBe('PERSON');
    void companies;
  });

  it('does not stack a second relation when the same fact is verified again', async () => {
    const { entityId } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveEntity(tx, keys, {
        entityType: 'BUSINESS',
        identifiers: [{ idType: 'CR', value: '1010777888' }],
      }),
    );

    await verify('KYB_COMPLETE', { unn: '7001272184' }, entityId);
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getRelations(tx, entityId),
    );

    await verify('KYB_COMPLETE', { unn: '7001272184' }, entityId);
    const after = await withTenant(db.appPool, tenant.tenantId, (tx) => getRelations(tx, entityId));

    expect(after).toHaveLength(before.length);
  });

  it('inserts a new attestation on re-verification while the relation stays one row', async () => {
    const { entityId } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveEntity(tx, keys, {
        entityType: 'BUSINESS',
        identifiers: [{ idType: 'CR', value: '1010999000' }],
      }),
    );

    await verify('KYB_COMPLETE', { unn: '7001272184' }, entityId);
    await verify('KYB_COMPLETE', { unn: '7001272184' }, entityId);

    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM attestations
         WHERE entity_id = $1 AND field_path = 'cr.status'`,
        [entityId],
      ),
    );
    // Two confirmations, two rows. Rule 1.
    expect(Number(rows[0]?.count)).toBe(2);
  });

  it('creates an account holder entity for a different product with no new code', async () => {
    const { entityId } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveEntity(tx, keys, {
        entityType: 'BANK_ACCOUNT',
        identifiers: [{ idType: 'IBAN', value: 'SA0380000000608010167519' }],
      }),
    );

    const { normalised } = await verify(
      'IBAN_OWNERSHIP',
      {
        iban: 'SA0380000000608010167519',
        identifier: { type: 'CR', value: '1010478213' },
      },
      entityId,
    );

    expect(normalised.entities.some((entry) => entry.role === 'ACCOUNT_HOLDER')).toBe(true);
    expect(normalised.relations.some((relation) => relation.relType === 'HOLDS_ACCOUNT')).toBe(
      true,
    );

    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, entityId),
    );
    expect(profile.find((field) => field.fieldPath === 'iban.ownership')?.value).toBe('MATCHED');
  });

  it('writes nothing for a step that failed or was skipped', async () => {
    const { entityId } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveEntity(tx, keys, {
        entityType: 'BUSINESS',
        identifiers: [{ idType: 'UNN', value: '7000000003' }],
      }),
    );

    const { outcome } = await verify('KYB_COMPLETE', { unn: '7000000003' }, entityId);
    expect(outcome.status).toBe('PARTIAL');

    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, entityId),
    );
    const paths = profile.map((field) => field.fieldPath);

    // The thin payload carried a status and nothing else. A missing field must leave no
    // attestation rather than an empty one, so a partial run never overwrites knowledge
    // with emptiness.
    expect(paths).toContain('cr.status');
    expect(paths).not.toContain('cr.core.name');
  });

  it('carries a lower confidence when the mapping says the evidence is weaker', async () => {
    const { entityId } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveEntity(tx, keys, {
        entityType: 'BANK_ACCOUNT',
        identifiers: [{ idType: 'IBAN', value: 'SA0380000000608010167777' }],
      }),
    );

    const { normalised } = await verify(
      'IBAN_OWNERSHIP',
      { iban: 'SA0380000000608010167519', identifier: { type: 'CR', value: '1010478213' } },
      entityId,
    );

    const holder = normalised.entities.find((entry) => entry.role === 'ACCOUNT_HOLDER');
    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, holder?.entityId ?? ''),
    );
    expect(profile.find((field) => field.fieldPath === 'holder.name')?.confidence).toBe(0.9);
  });

  it('keeps relations inside the tenant', async () => {
    const other = await seedTenant(db.appPool, 'Normalisation Other Tenant');
    const managers = await withTenant(db.appPool, other.tenantId, (tx) =>
      findEntitiesLinkedToMany(tx, 'MANAGES', 1),
    );
    expect(managers).toEqual([]);
  });
});


/**
 * A relation that ends (ADR-168).
 *
 * `ended_at` was written by no code path in this repository, so every relation ever recorded
 * was permanent: a manager who resigned stayed a manager on the customer file forever and kept
 * raising `manager_many_companies` and the SHARED_MANAGER intersection, with no action
 * available to anybody to stop it. `endRelation` existed and had no caller at all.
 */
describe('a role somebody no longer holds', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('stops counting, and keeps its answer for the month it applied to', async () => {
    const { endRelation } = await import('../src/normalisation/normalise.js');
    const { findEntitiesLinkedToMany } = await import('../src/normalisation/network.js');

    const tenant = await seedTenant(db.appPool, 'شركة الصفات');
    const person = await seedEntity(db.appPool, tenant.tenantId, 'PERSON', 'مدير');
    const attestation = await insertAttestation(db.appPool, tenant);

    const companies: string[] = [];
    for (const name of ['الأولى', 'الثانية', 'الثالثة']) {
      companies.push(await seedEntity(db.appPool, tenant.tenantId, 'BUSINESS', name));
    }
    const relationIds = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const ids: string[] = [];
      for (const company of companies) {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO entity_relations
             (tenant_id, from_entity, to_entity, rel_type, attestation_id, valid_from)
           VALUES ($1, $2, $3, 'MANAGES', $4, now()) RETURNING id`,
          [tx.tenantId, company, person, attestation],
        );
        ids.push(rows[0]?.id ?? '');
      }
      return ids;
    });

    const linkedTo = async (): Promise<number> => {
      const found = await withTenant(db.appPool, tenant.tenantId, (tx) =>
        findEntitiesLinkedToMany(tx, 'MANAGES', 3),
      );
      return found.find((row) => row.entityId === person)?.linkedCount ?? 0;
    };

    // Three companies: the report that sells the platform names them.
    expect(await linkedTo()).toBe(3);

    await withTenant(db.appPool, tenant.tenantId, (tx) => endRelation(tx, relationIds[0] ?? ''));

    // Two now, so the person drops below the threshold and stops being a finding.
    expect(await linkedTo()).toBe(0);

    // And the row is still there with a date on it, which is rule 1 in the currency of
    // relations: «who was the authorised manager in March» keeps its answer.
    const kept = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ ended_at: Date | null }>(
        `SELECT ended_at FROM entity_relations WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, relationIds[0]],
      ),
    );
    expect(kept.rows).toHaveLength(1);
    expect(kept.rows[0]?.ended_at).not.toBeNull();
  });
});
