import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { getEntity, resolveEntity } from '../src/repositories/entities.js';
import { listIdentifiers } from '../src/repositories/identifiers.js';
import { NxError } from '../src/errors.js';

/** Unit 2 acceptance: the same identifier never creates a duplicate entity. */

describe('identity resolution', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Resolution Tenant');
  });

  afterAll(async () => {
    await db.close();
  });

  const resolve = (input: Parameters<typeof resolveEntity>[2]) =>
    withTenant(db.appPool, tenant.tenantId, (tx) => resolveEntity(tx, keys, input));

  it('creates an entity the first time an identifier is seen', async () => {
    const result = await resolve({
      entityType: 'BUSINESS',
      identifiers: [{ idType: 'CR', value: '1010111111', isPrimary: true }],
      displayName: 'First Company',
    });
    expect(result.created).toBe(true);
    expect(result.matchedBy).toBeNull();
  });

  it('returns the same entity for the same identifier', async () => {
    const first = await resolve({
      entityType: 'BUSINESS',
      identifiers: [{ idType: 'CR', value: '1010222222' }],
    });
    const second = await resolve({
      entityType: 'BUSINESS',
      identifiers: [{ idType: 'CR', value: '1010222222' }],
    });

    expect(second.created).toBe(false);
    expect(second.entityId).toBe(first.entityId);
    expect(second.matchedBy).toBe('CR');
  });

  it('matches through formatting differences', async () => {
    const first = await resolve({
      entityType: 'BUSINESS',
      identifiers: [{ idType: 'CR', value: '1010333333' }],
    });
    const second = await resolve({
      entityType: 'BUSINESS',
      identifiers: [{ idType: 'CR', value: ' 1010-333-333 ' }],
    });
    expect(second.entityId).toBe(first.entityId);
  });

  it('does not duplicate the entity across ten repeated verifications', async () => {
    const ids = new Set<string>();
    for (let index = 0; index < 10; index += 1) {
      const result = await resolve({
        entityType: 'BUSINESS',
        identifiers: [{ idType: 'UNN', value: '7001272184' }],
      });
      ids.add(result.entityId);
    }
    expect(ids.size).toBe(1);
  });

  it('merges a newly supplied identifier into the entity already matched', async () => {
    const first = await resolve({
      entityType: 'BUSINESS',
      identifiers: [{ idType: 'CR', value: '1010444444' }],
    });
    const second = await resolve({
      entityType: 'BUSINESS',
      identifiers: [
        { idType: 'CR', value: '1010444444' },
        { idType: 'UNN', value: '7009999999' },
      ],
    });

    expect(second.entityId).toBe(first.entityId);
    const identifiers = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listIdentifiers(tx, keys, first.entityId),
    );
    expect(identifiers.map((entry) => entry.idType).sort()).toEqual(['CR', 'UNN']);
  });

  it('refuses to merge two entities on its own', async () => {
    const left = await resolve({
      entityType: 'BUSINESS',
      identifiers: [{ idType: 'CR', value: '1010555555' }],
    });
    const right = await resolve({
      entityType: 'BUSINESS',
      identifiers: [{ idType: 'UNN', value: '7005555555' }],
    });
    expect(left.entityId).not.toBe(right.entityId);

    // Merging rewrites history, and history is the product here. A human decides.
    await expect(
      resolve({
        entityType: 'BUSINESS',
        identifiers: [
          { idType: 'CR', value: '1010555555' },
          { idType: 'UNN', value: '7005555555' },
        ],
      }),
    ).rejects.toBeInstanceOf(NxError);
  });

  it('keeps entities separate across tenants that share an identifier', async () => {
    const other = await seedTenant(db.appPool, 'Resolution Other Tenant');
    const mine = await resolve({
      entityType: 'BUSINESS',
      identifiers: [{ idType: 'CR', value: '1010666666' }],
    });
    const theirs = await withTenant(db.appPool, other.tenantId, (tx) =>
      resolveEntity(tx, keys, {
        entityType: 'BUSINESS',
        identifiers: [{ idType: 'CR', value: '1010666666' }],
      }),
    );

    expect(theirs.entityId).not.toBe(mine.entityId);
    expect(theirs.created).toBe(true);
  });

  it('refuses to resolve without an identifier', async () => {
    await expect(resolve({ entityType: 'BUSINESS', identifiers: [] })).rejects.toBeInstanceOf(
      NxError,
    );
  });

  it('advances last_seen_at when an existing entity is seen again', async () => {
    const first = await resolve({
      entityType: 'BUSINESS',
      identifiers: [{ idType: 'CR', value: '1010777777' }],
    });
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntity(tx, first.entityId),
    );

    await resolve({
      entityType: 'BUSINESS',
      identifiers: [{ idType: 'CR', value: '1010777777' }],
      displayName: 'Renamed Company',
    });

    const after = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntity(tx, first.entityId),
    );

    expect(after?.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before?.lastSeenAt.getTime() ?? 0);
    expect(after?.firstSeenAt.getTime()).toBe(before?.firstSeenAt.getTime());
    expect(after?.displayName).toBe('Renamed Company');
  });
});
