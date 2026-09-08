import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../packages/db/src/client.js';
import {
  attachIdentifier,
  findEntityIdByIdentifier,
  listIdentifiers,
} from '../../packages/core/src/repositories/identifiers.js';
import { normalizeIdentifier } from '../../packages/core/src/crypto/identifier.js';
import { NxError } from '../../packages/core/src/errors.js';
import {
  createTestDatabase,
  seedEntity,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../helpers/db.js';
import { scanForPlaintext } from '../helpers/plaintext-scan.js';

/**
 * Guard 05: no identifier is stored, logged or reported in clear text.
 *
 * Rule 4. The hash is keyed per tenant for lookup, the encrypted column is for display,
 * and neither the storage layer nor any error path may reveal the value.
 *
 * The scan walks the catalog rather than a fixed list of columns, so a column added in a
 * later unit that stores an identifier as text fails this guard without anyone editing
 * the test.
 */

const NATIONAL_ID = '1098765432';
const CR_NUMBER = '1010478213';
const IBAN = 'SA0380000000608010167519';

describe('guard 05: no plaintext identifiers', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Guard 05 Tenant');

    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await attachIdentifier(tx, keys, {
        entityId: tenant.entityId,
        idType: 'CR',
        value: CR_NUMBER,
        isPrimary: true,
      });
      await attachIdentifier(tx, keys, {
        entityId: tenant.entityId,
        idType: 'NATIONAL_ID',
        value: NATIONAL_ID,
      });
      await attachIdentifier(tx, keys, {
        entityId: tenant.entityId,
        idType: 'IBAN',
        value: IBAN,
      });
    });
  });

  afterAll(async () => {
    await db.close();
  });

  for (const [label, value] of [
    ['national id', NATIONAL_ID],
    ['commercial registration number', CR_NUMBER],
    ['iban', IBAN],
  ] as const) {
    it(`stores no ${label} in any column of any table`, async () => {
      const hits = await withTenant(db.migratorPool, tenant.tenantId, (tx) =>
        scanForPlaintext(tx, value),
      );
      expect(hits).toEqual([]);
    });
  }

  it('stores the identifier with a formatting variant unfindable as well', async () => {
    // A caller may send the value spaced or hyphenated. Normalisation happens before
    // hashing, so neither form may appear anywhere.
    const hits = await withTenant(db.migratorPool, tenant.tenantId, (tx) =>
      scanForPlaintext(tx, 'SA03 8000 0000 6080 1016 7519'.replace(/\s/g, '')),
    );
    expect(hits).toEqual([]);
  });

  it('still finds the entity by the identifier, in any formatting', async () => {
    const found = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      findEntityIdByIdentifier(tx, keys, 'IBAN', 'sa03 8000-0000 6080 1016 7519'),
    );
    expect(found).toBe(tenant.entityId);
  });

  it('gives a different hash for the same identifier in a different tenant', async () => {
    const other = await seedTenant(db.appPool, 'Guard 05 Other Tenant');
    await withTenant(db.appPool, other.tenantId, (tx) =>
      attachIdentifier(tx, keys, {
        entityId: other.entityId,
        idType: 'NATIONAL_ID',
        value: NATIONAL_ID,
      }),
    );

    const readHash = (tenantId: string) =>
      withTenant(db.migratorPool, tenantId, async (tx) => {
        const result = await tx.query<{ id_value_hash: Buffer }>(
          `SELECT id_value_hash FROM entity_identifiers WHERE id_type = 'NATIONAL_ID'`,
        );
        return result.rows[0]?.id_value_hash;
      });

    const [first, second] = await Promise.all([
      readHash(tenant.tenantId),
      readHash(other.tenantId),
    ]);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Correlating a person across tenants must be impossible from the table alone.
    expect(first?.equals(second ?? Buffer.alloc(0))).toBe(false);
  });

  it('keeps the value out of the error raised when an identifier belongs elsewhere', async () => {
    const otherEntity = await seedEntity(db.appPool, tenant.tenantId, 'PERSON', 'Someone Else');

    const error = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      attachIdentifier(tx, keys, {
        entityId: otherEntity,
        idType: 'NATIONAL_ID',
        value: NATIONAL_ID,
      }),
    ).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(NxError);
    const serialized = JSON.stringify({
      message: (error as Error).message,
      stack: (error as Error).stack,
      public: (error as NxError).toPublicJson(),
    });
    expect(serialized).not.toContain(NATIONAL_ID);
  });

  it('keeps the value out of a normalisation error', () => {
    let thrown: unknown;
    try {
      normalizeIdentifier('NATIONAL_ID', 'abc-def');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NxError);
    expect((thrown as Error).message).not.toContain('abc-def');
  });

  it('masks the identifier when the console lists it', async () => {
    const identifiers = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listIdentifiers(tx, keys, tenant.entityId),
    );

    const nationalId = identifiers.find((entry) => entry.idType === 'NATIONAL_ID');
    expect(nationalId?.masked).toBe('••••••5432');
    for (const entry of identifiers) {
      expect(entry.masked).not.toContain(NATIONAL_ID);
      expect(entry.masked).not.toContain(CR_NUMBER);
    }
  });
});
