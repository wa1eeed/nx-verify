import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../packages/db/src/client.js';
import {
  createTestDatabase,
  insertAttestation,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../helpers/db.js';

/**
 * Guard 02: tenant A never sees a row belonging to tenant B.
 *
 * Rules 2, 3 and 12. The enumeration tests below are deliberately written against the
 * catalog rather than against a fixed list of tables, so a table added later without row
 * level security fails this guard without anyone remembering to edit it.
 */

/** Tables that are tenant scoped through a column other than tenant_id. */
const TENANT_SCOPED_BY_PRIMARY_KEY = ['tenants'];

describe('guard 02: tenant isolation', () => {
  let db: TestDatabase;
  let alpha: SeededTenant;
  let beta: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    alpha = await seedTenant(db.appPool, 'Alpha');
    beta = await seedTenant(db.appPool, 'Beta');
    await insertAttestation(db.appPool, alpha, { fieldPath: 'cr.status' });
    await insertAttestation(db.appPool, beta, { fieldPath: 'cr.status' });
  });

  afterAll(async () => {
    await db.close();
  });

  it('hides another tenant rows in every tenant scoped table', async () => {
    const visible = await withTenant(db.appPool, alpha.tenantId, async (tx) => {
      const tenants = await tx.query('SELECT id FROM tenants');
      const entities = await tx.query('SELECT id FROM entities');
      const attestations = await tx.query('SELECT id FROM attestations');
      return {
        tenants: tenants.rows.length,
        entities: entities.rows.length,
        attestations: attestations.rows.length,
      };
    });

    expect(visible).toEqual({ tenants: 1, entities: 1, attestations: 1 });
  });

  it('returns nothing when a row is addressed by primary key across tenants', async () => {
    const rows = await withTenant(db.appPool, alpha.tenantId, async (tx) => {
      const result = await tx.query('SELECT id FROM entities WHERE id = $1', [beta.entityId]);
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('refuses an insert that carries another tenant id', async () => {
    await expect(
      withTenant(db.appPool, alpha.tenantId, (tx) =>
        tx.query('INSERT INTO entities (tenant_id, entity_type) VALUES ($1, $2)', [
          beta.tenantId,
          'BUSINESS',
        ]),
      ),
      // Without WITH CHECK the policy would allow writing rows into another tenant while
      // still hiding them, which is worse than a read leak.
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('refuses to move a row to another tenant', async () => {
    await expect(
      withTenant(db.appPool, alpha.tenantId, (tx) =>
        tx.query('UPDATE entities SET tenant_id = $1 WHERE id = $2', [
          beta.tenantId,
          alpha.entityId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('fails closed: an unset tenant context yields zero rows, not every row', async () => {
    const counts = await withoutTenant(db.appPool, async (tx) => {
      const tenants = await tx.query('SELECT id FROM tenants');
      const entities = await tx.query('SELECT id FROM entities');
      const attestations = await tx.query('SELECT id FROM attestations');
      return [tenants.rows.length, entities.rows.length, attestations.rows.length];
    });
    expect(counts).toEqual([0, 0, 0]);
  });

  it('does not leak the tenant context out of a pooled connection', async () => {
    await withTenant(db.appPool, alpha.tenantId, (tx) => tx.query('SELECT 1'));
    const leaked = await withoutTenant(db.appPool, async (tx) => {
      const result = await tx.query<{ tenant: string | null }>(
        `SELECT current_setting('app.tenant_id', true) AS tenant`,
      );
      return result.rows[0]?.tenant ?? null;
    });
    expect(leaked === null || leaked === '').toBe(true);
  });

  it('enables and forces row level security on every tenant scoped table', async () => {
    const { rows } = await db.migratorPool.query<{
      table_name: string;
      enabled: boolean;
      forced: boolean;
    }>(
      `SELECT c.relname AS table_name,
              c.relrowsecurity AS enabled,
              c.relforcerowsecurity AS forced
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND (
           EXISTS (
             SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0
               AND NOT a.attisdropped
           )
           OR c.relname = ANY($1::text[])
         )
       ORDER BY c.relname`,
      [TENANT_SCOPED_BY_PRIMARY_KEY],
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.enabled, `${row.table_name} must enable row level security`).toBe(true);
      // Without FORCE the owner bypasses every policy and this guard passes falsely.
      expect(row.forced, `${row.table_name} must force row level security`).toBe(true);
    }
  });

  it('gives every tenant scoped table a policy with both USING and WITH CHECK', async () => {
    const { rows } = await db.migratorPool.query<{
      tablename: string;
      qual: string | null;
      with_check: string | null;
    }>(
      `SELECT p.tablename, p.qual, p.with_check
       FROM pg_policies p
       WHERE p.schemaname = 'public'
       ORDER BY p.tablename, p.policyname`,
    );

    const tablesWithPolicy = new Set(rows.map((row) => row.tablename));
    expect([...tablesWithPolicy].sort()).toEqual(['attestations', 'entities', 'tenants']);

    for (const row of rows) {
      expect(row.qual, `${row.tablename} policy needs USING`).toBeTruthy();
      expect(row.with_check, `${row.tablename} policy needs WITH CHECK`).toBeTruthy();
      expect(row.qual).toContain('current_tenant()');
      expect(row.with_check).toContain('current_tenant()');
    }
  });

  it('keeps the application role free of BYPASSRLS and free of ownership', async () => {
    const { rows: roles } = await db.migratorPool.query<{
      rolname: string;
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>(
      `SELECT rolname, rolbypassrls, rolsuper
       FROM pg_roles
       WHERE rolname LIKE 'nx\\_%'
       ORDER BY rolname`,
    );

    expect(roles.map((role) => role.rolname)).toEqual(['nx_app', 'nx_migrator', 'nx_retention']);
    for (const role of roles) {
      expect(role.rolbypassrls, `${role.rolname} must not bypass row level security`).toBe(false);
      expect(role.rolsuper, `${role.rolname} must not be a superuser`).toBe(false);
    }

    const { rows: owners } = await db.migratorPool.query<{
      tablename: string;
      tableowner: string;
    }>(`SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public'`);

    expect(owners.length).toBeGreaterThan(0);
    for (const table of owners) {
      expect(table.tableowner, `${table.tablename} must not be owned by the application role`).toBe(
        'nx_migrator',
      );
    }
  });
});
