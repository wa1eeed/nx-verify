import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../packages/db/src/client.js';
import {
  createTestDatabase,
  insertAttestation,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../helpers/db.js';

/**
 * Guard 01: UPDATE and DELETE on attestations raise an error.
 *
 * Rule 1. New knowledge is a new row. The single permitted mutation is setting
 * superseded_by once on the previous row. Deletion belongs to the retention role alone.
 *
 * Two layers protect the table, and each is tested on its own:
 *
 *   Layer 1, privileges. The application role holds no UPDATE beyond the superseded_by
 *   column and no DELETE at all, so the statement is refused with 42501 before any row
 *   is examined.
 *
 *   Layer 2, triggers. Tested through the owner role, which does hold those privileges.
 *   If the grants were ever widened by mistake, this layer still raises.
 *
 * Testing only through the application role would leave layer 2 unproven, because layer 1
 * refuses first and the trigger never runs.
 */

const IMMUTABLE = 'NX001';
const DELETE_FORBIDDEN = 'NX002';
const INSUFFICIENT_PRIVILEGE = '42501';

describe('guard 01: attestations are append only', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Guard 01 Tenant');
  });

  afterAll(async () => {
    await db.close();
  });

  describe('layer 1: the application role is not granted the operation', () => {
    it('refuses to update value', async () => {
      const id = await insertAttestation(db.appPool, tenant);
      await expect(
        withTenant(db.appPool, tenant.tenantId, (tx) =>
          tx.query(
            `UPDATE attestations SET value = '{"status":"suspended"}'::jsonb WHERE id = $1`,
            [id],
          ),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('refuses to update observed_at', async () => {
      const id = await insertAttestation(db.appPool, tenant);
      await expect(
        withTenant(db.appPool, tenant.tenantId, (tx) =>
          tx.query('UPDATE attestations SET observed_at = now() WHERE id = $1', [id]),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('refuses DELETE', async () => {
      const id = await insertAttestation(db.appPool, tenant);
      await expect(
        withTenant(db.appPool, tenant.tenantId, (tx) =>
          tx.query('DELETE FROM attestations WHERE id = $1', [id]),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('grants UPDATE on superseded_by alone, and no DELETE', async () => {
      const { rows } = await db.migratorPool.query<{ privilege_type: string }>(
        `SELECT privilege_type
         FROM information_schema.role_table_grants
         WHERE grantee = 'nx_app' AND table_name = 'attestations'
         ORDER BY privilege_type`,
      );
      const privileges = rows.map((row) => row.privilege_type);
      expect(privileges).toContain('SELECT');
      expect(privileges).toContain('INSERT');
      expect(privileges).not.toContain('UPDATE');
      expect(privileges).not.toContain('DELETE');

      const { rows: columnGrants } = await db.migratorPool.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.column_privileges
         WHERE grantee = 'nx_app' AND table_name = 'attestations' AND privilege_type = 'UPDATE'`,
      );
      expect(columnGrants.map((row) => row.column_name)).toEqual(['superseded_by']);
    });
  });

  describe('layer 2: the database refuses even a privileged writer', () => {
    it('refuses to update value', async () => {
      const id = await insertAttestation(db.appPool, tenant);
      await expect(
        withTenant(db.migratorPool, tenant.tenantId, (tx) =>
          tx.query(
            `UPDATE attestations SET value = '{"status":"suspended"}'::jsonb WHERE id = $1`,
            [id],
          ),
        ),
      ).rejects.toMatchObject({ code: IMMUTABLE });
    });

    it('refuses to update observed_at, which would erase when the fact was last confirmed', async () => {
      const id = await insertAttestation(db.appPool, tenant);
      await expect(
        withTenant(db.migratorPool, tenant.tenantId, (tx) =>
          tx.query('UPDATE attestations SET observed_at = now() WHERE id = $1', [id]),
        ),
      ).rejects.toMatchObject({ code: IMMUTABLE });
    });

    it('refuses to update authority, which would rewrite provenance', async () => {
      const id = await insertAttestation(db.appPool, tenant);
      await expect(
        withTenant(db.migratorPool, tenant.tenantId, (tx) =>
          tx.query(`UPDATE attestations SET authority = 'ZATCA' WHERE id = $1`, [id]),
        ),
      ).rejects.toMatchObject({ code: IMMUTABLE });
    });

    it('refuses to change another column in the same statement that sets superseded_by', async () => {
      const older = await insertAttestation(db.appPool, tenant);
      const newer = await insertAttestation(db.appPool, tenant);
      await expect(
        withTenant(db.migratorPool, tenant.tenantId, (tx) =>
          tx.query('UPDATE attestations SET superseded_by = $1, confidence = 0.500 WHERE id = $2', [
            newer,
            older,
          ]),
        ),
      ).rejects.toMatchObject({ code: IMMUTABLE });
    });

    it('refuses DELETE', async () => {
      const id = await insertAttestation(db.appPool, tenant);
      await expect(
        withTenant(db.migratorPool, tenant.tenantId, (tx) =>
          tx.query('DELETE FROM attestations WHERE id = $1', [id]),
        ),
      ).rejects.toMatchObject({ code: DELETE_FORBIDDEN });
    });
  });

  describe('the one permitted mutation', () => {
    it('allows superseded_by to be set exactly once', async () => {
      const older = await insertAttestation(db.appPool, tenant);
      const newer = await insertAttestation(db.appPool, tenant);

      const updated = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
        const result = await tx.query('UPDATE attestations SET superseded_by = $1 WHERE id = $2', [
          newer,
          older,
        ]);
        return result.rowCount;
      });
      expect(updated).toBe(1);

      const third = await insertAttestation(db.appPool, tenant);
      await expect(
        withTenant(db.appPool, tenant.tenantId, (tx) =>
          tx.query('UPDATE attestations SET superseded_by = $1 WHERE id = $2', [third, older]),
        ),
      ).rejects.toMatchObject({ code: IMMUTABLE });
    });

    it('refuses to clear superseded_by', async () => {
      const older = await insertAttestation(db.appPool, tenant);
      const newer = await insertAttestation(db.appPool, tenant);

      await withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query('UPDATE attestations SET superseded_by = $1 WHERE id = $2', [newer, older]),
      );

      await expect(
        withTenant(db.appPool, tenant.tenantId, (tx) =>
          tx.query('UPDATE attestations SET superseded_by = NULL WHERE id = $1', [older]),
        ),
      ).rejects.toMatchObject({ code: IMMUTABLE });
    });

    it('keeps the superseded row in place instead of removing it', async () => {
      const older = await insertAttestation(db.appPool, tenant, { fieldPath: 'cr.core' });
      const newer = await insertAttestation(db.appPool, tenant, { fieldPath: 'cr.core' });

      await withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query('UPDATE attestations SET superseded_by = $1 WHERE id = $2', [newer, older]),
      );

      const rows = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
        const result = await tx.query<{ id: string; superseded_by: string | null }>(
          'SELECT id, superseded_by FROM attestations WHERE field_path = $1 ORDER BY created_at',
          ['cr.core'],
        );
        return result.rows;
      });

      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.id === older)?.superseded_by).toBe(newer);
      expect(rows.find((row) => row.id === newer)?.superseded_by).toBeNull();
    });
  });

  describe('deletion belongs to the retention role', () => {
    it('permits DELETE from the retention role alone', async () => {
      const id = await insertAttestation(db.appPool, tenant);

      const deleted = await withTenant(db.retentionPool, tenant.tenantId, async (tx) => {
        const result = await tx.query('DELETE FROM attestations WHERE id = $1', [id]);
        return result.rowCount;
      });

      expect(deleted).toBe(1);
    });

    it('is the only role granted DELETE on attestations', async () => {
      // PostgreSQL gives the table owner every privilege implicitly and it cannot be
      // revoked durably, since the owner can always grant it back. That is exactly why
      // layer 2 exists: the trigger refuses the owner too, as proven above.
      const { rows } = await db.migratorPool.query<{ grantee: string }>(
        `SELECT grantee
         FROM information_schema.role_table_grants
         WHERE table_name = 'attestations' AND privilege_type = 'DELETE'
           AND grantee LIKE 'nx\\_%'
           AND grantee <> (SELECT tableowner FROM pg_tables WHERE tablename = 'attestations')
         ORDER BY grantee`,
      );
      expect(rows.map((row) => row.grantee)).toEqual(['nx_retention']);
    });
  });
});
