import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  DerivedTenantKeyProvider,
  StaticMasterKeySource,
} from '../../../packages/core/src/index.js';
import {
  attachIdentifier,
  findEntityIdByIdentifier,
  listIdentifiers,
} from '../../../packages/core/src/repositories/identifiers.js';
import { resolveEntity } from '../../../packages/core/src/repositories/entities.js';
import {
  buildEvidenceContent,
  checkEvidence,
  evidenceKeyVersion,
  sealEvidence,
} from '../../../packages/core/src/evidence/evidence.js';
import { verify } from '../../../packages/core/src/verification/verify.js';
import { readAudit } from '../../../packages/core/src/auth/audit.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';
import {
  activateKeyVersion,
  listKeyVersions,
} from '../../../packages/core/src/crypto/key-versions.js';
import { canRetireKeyVersion, rotateIdentifierKeys } from '../src/jobs/key-rotation.js';
import { scanForPlaintext } from '../../../test/helpers/plaintext-scan.js';

/**
 * Key rotation, which the platform promised and could not do.
 *
 * The identifier hash is the lookup index. Rotating the key without versioning would have
 * left every hash unmatchable, and the next verification of a known company would have
 * created a second entity for it. These tests are about that not happening.
 */

const V1 = Buffer.alloc(32, 7);
const V2 = Buffer.alloc(32, 9);
const NATIONAL_ID = '1098765432';
const CR = '1010478213';

const oldKeys = new DerivedTenantKeyProvider(new StaticMasterKeySource(new Map([[1, V1]])));
const bothKeys = new DerivedTenantKeyProvider(
  new StaticMasterKeySource(
    new Map([
      [1, V1],
      [2, V2],
    ]),
  ),
);

describe('key rotation', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let entityId = '';
  let evidenceId = '';
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Rotation Tenant');
    await preparePricedTenant(db.appPool, tenant.tenantId, { balanceHalalas: 5_000_00 });

    // Everything below is written under version 1.
    const resolved = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const entity = await resolveEntity(tx, oldKeys, {
        entityType: 'BUSINESS',
        identifiers: [{ idType: 'CR', value: CR }],
        displayName: 'شركة قبل التدوير',
      });
      await attachIdentifier(tx, oldKeys, {
        entityId: entity.entityId,
        idType: 'NATIONAL_ID',
        value: NATIONAL_ID,
      });
      return entity.entityId;
    });
    entityId = resolved;

    const run = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn: '7001272184' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7001272184' }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys: oldKeys,
      }),
    );

    const sealed = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const content = await buildEvidenceContent(tx, run.runId);
      return sealEvidence(tx, {
        runId: run.runId,
        content,
        storageKey: 'evidence/rotation.pdf',
        signingKey: await oldKeys.signingKey(tenant.tenantId, 1),
        keyVersion: 1,
      });
    });
    evidenceId = sealed.evidenceId;
  });

  afterAll(async () => {
    await db.close();
  });

  it('records the version that produced every stored identifier', async () => {
    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ key_version: number }>(
        `SELECT DISTINCT key_version FROM entity_identifiers WHERE entity_id = $1`,
        [entityId],
      ),
    );
    expect(rows.map((row) => row.key_version)).toEqual([1]);
  });

  it('registers a new version before anything is written with it', async () => {
    // The version column carries a foreign key, so a row cannot be written under a key
    // nobody declared. Rotation is two operator acts, and this is the first.
    await activateKeyVersion(db.operatorPool, 2, 'Ninety day rotation');

    const versions = await listKeyVersions(db.operatorPool);
    expect(versions.find((entry) => entry.version === 1)?.status).toBe('retiring');
    expect(versions.find((entry) => entry.version === 2)?.status).toBe('active');
  });

  it('still finds an entity written under the old key after the key changes', async () => {
    // The new key is now current, and nothing has been rotated yet.
    const found = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      findEntityIdByIdentifier(tx, bothKeys, 'CR', CR),
    );

    // Without this, the next verification of a known company would create a second
    // entity for it, which is the failure the whole scheme exists to prevent.
    expect(found).toBe(entityId);
  });

  it('does not duplicate an entity when it is verified during a rotation', async () => {
    const resolved = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveEntity(tx, bothKeys, {
        entityType: 'BUSINESS',
        identifiers: [{ idType: 'CR', value: CR }],
      }),
    );

    expect(resolved.created).toBe(false);
    expect(resolved.entityId).toBe(entityId);
  });

  it('still decrypts an identifier written under the old key', async () => {
    const identifiers = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listIdentifiers(tx, bothKeys, entityId),
    );
    expect(identifiers.find((entry) => entry.idType === 'NATIONAL_ID')?.masked).toBe('••••••5432');
  });

  it('moves the rows onto the new key, and says how many are left', async () => {
    const summary = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      rotateIdentifierKeys(tx, { keys: bothKeys }),
    );

    expect(summary.targetVersion).toBe(2);
    expect(summary.rotated).toBeGreaterThan(0);
    expect(summary.remaining).toBe(0);

    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ key_version: number }>(`SELECT DISTINCT key_version FROM entity_identifiers`),
    );
    expect(rows.map((row) => row.key_version)).toEqual([2]);
  });

  it('finds the same entity by the same identifier after rotation', async () => {
    const byCr = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      findEntityIdByIdentifier(tx, bothKeys, 'CR', CR),
    );
    const byNationalId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      findEntityIdByIdentifier(tx, bothKeys, 'NATIONAL_ID', NATIONAL_ID),
    );

    expect(byCr).toBe(entityId);
    expect(byNationalId).toBe(entityId);
  });

  it('leaves no identifier in the clear at any point in the rotation', async () => {
    const hits = await withTenant(db.migratorPool, tenant.tenantId, (tx) =>
      scanForPlaintext(tx, NATIONAL_ID),
    );
    // The plaintext exists in memory for one loop iteration and is never written.
    expect(hits).toEqual([]);
  });

  it('produces a different stored hash than before, which is the point', async () => {
    const oldHash = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const key = await oldKeys.hmacKey(tenant.tenantId, 1);
      const { hashIdentifier } = await import('../../../packages/core/src/crypto/identifier.js');
      const { rows } = await tx.query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM entity_identifiers WHERE id_value_hash = $1
         ) AS present`,
        [hashIdentifier(key, 'CR', CR)],
      );
      return rows[0]?.present;
    });

    // The old hash is gone from the table. If it were still there, nothing had rotated.
    expect(oldHash).toBe(false);
  });

  it('leaves evidence signed by the old key alone, and it still verifies', async () => {
    const version = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      evidenceKeyVersion(tx, evidenceId),
    );
    expect(version).toBe(1);

    const result = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const { rows } = await tx.query<{ run_id: string }>(
        `SELECT run_id FROM evidence WHERE id = $1`,
        [evidenceId],
      );
      const content = await buildEvidenceContent(tx, rows[0]?.run_id ?? '');
      return checkEvidence(
        tx,
        evidenceId,
        content,
        await bothKeys.signingKey(tenant.tenantId, version),
      );
    });

    // Re-signing would change a hash a customer has already handed to an auditor.
    expect(result.signatureValid).toBe(true);
  });

  it('refuses to call the old version retirable while a seal still needs it', async () => {
    const check = await withTenant(db.appPool, tenant.tenantId, (tx) => canRetireKeyVersion(tx, 1));

    expect(check.identifiersRemaining).toBe(0);
    expect(check.evidenceSealed).toBeGreaterThan(0);
    // Discarding it would silently turn an audit document into one nobody can check.
    expect(check.safeToRetire).toBe(false);
  });

  it('records the rotation, since it explains why every hash in the table changed', async () => {
    const entries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      readAudit(tx, { action: 'keys.rotated' }),
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.actorType).toBe('SYSTEM');
  });

  it('is safe to run again when there is nothing left to move', async () => {
    const summary = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      rotateIdentifierKeys(tx, { keys: bothKeys }),
    );
    expect(summary.rotated).toBe(0);
    expect(summary.remaining).toBe(0);
  });
});
