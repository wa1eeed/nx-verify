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

/**
 * Tables that carry no tenant_id and are scoped through a row they belong to.
 *
 * decision_rules belongs to a ruleset, and the ruleset carries the tenant, so its policy
 * reaches the tenant through that reference. Listing them here is deliberate friction:
 * adding one means arguing that the reference really is the boundary.
 */
const TENANT_SCOPED_BY_REFERENCE = ['decision_rules'];

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
         AND c.relkind IN ('r', 'p')
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
      policyname: string;
      roles: string;
      qual: string | null;
      with_check: string | null;
    }>(
      `SELECT p.tablename, p.policyname, p.roles::text AS roles, p.qual, p.with_check
       FROM pg_policies p
       WHERE p.schemaname = 'public'
       ORDER BY p.tablename, p.policyname`,
    );

    const { rows: expected } = await db.migratorPool.query<{ table_name: string }>(
      `SELECT c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
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

    const tablesWithPolicy = [...new Set(rows.map((row) => row.tablename))].sort();

    // The direction that matters, derived from the catalog rather than listed here: every
    // table carrying tenant data has a policy, and a table added in a later unit fails
    // this without anyone remembering to edit the test.
    for (const table of expected.map((row) => row.table_name)) {
      expect(tablesWithPolicy, `${table} has no policy`).toContain(table);
    }

    // And nothing else has one unless it was argued for above.
    const unexplained = tablesWithPolicy.filter(
      (table) =>
        !expected.some((row) => row.table_name === table) &&
        !TENANT_SCOPED_BY_REFERENCE.includes(table),
    );
    expect(unexplained).toEqual([]);

    for (const table of tablesWithPolicy) {
      const policies = rows.filter((row) => row.tablename === table);

      // At least one policy must scope the table to the tenant in context, with both a
      // read and a write clause. Without WITH CHECK a tenant could write rows into
      // another tenant while still being unable to see them, which is worse.
      const tenantScoped = policies.filter(
        (policy) =>
          policy.qual?.includes('current_tenant()') &&
          policy.with_check?.includes('current_tenant()'),
      );
      expect(tenantScoped.length, `${table} needs a tenant scoped policy`).toBeGreaterThan(0);

      // Any other policy must be restricted to a named role that is not the application
      // role. An operator path is acceptable; a wider path for nx_app is not.
      for (const policy of policies) {
        if (tenantScoped.includes(policy)) {
          continue;
        }
        const roles = policy.roles;
        expect(roles, `${table}: ${policy.policyname} must name its roles`).not.toContain('public');
        expect(roles, `${table}: ${policy.policyname} must not widen nx_app`).not.toContain(
          'nx_app',
        );
        expect(roles, `${table}: ${policy.policyname} must not widen nx_retention`).not.toContain(
          'nx_retention',
        );

        // nx_operator crosses tenants by design, and only for configuration. It must
        // never be given a policy on a table that holds a subscriber's own data.
        //
        // The test for adding a table to this list is one question: does a row here say
        // what the subscriber bought, or what the subscriber knows? A package code, a
        // billing period and a negotiated price are the first. An entity, an attestation,
        // an identifier, a decision and a usage count are the second, and none of them
        // may ever appear below.
        if (roles.includes('nx_operator')) {
          expect(
            [
              'tenant_provider_binding',
              'tenants',
              'audit_log',
              'tenant_commitments',
              'tenant_product_overrides',
            ],
            `${table}: nx_operator must not reach subscriber data`,
          ).toContain(table);
        }
      }
    }
  });

  it('makes every view a security invoker view', async () => {
    // A view runs with its owner's privileges by default, and the owner owns every
    // table. Without security_invoker a view reads straight past every policy and hands
    // one tenant another tenant's rows.
    const { rows } = await db.migratorPool.query<{
      viewname: string;
      options: string[] | null;
    }>(
      `SELECT c.relname AS viewname, c.reloptions AS options
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
       ORDER BY c.relname`,
    );

    for (const view of rows) {
      expect(
        view.options ?? [],
        `view ${view.viewname} must be created WITH (security_invoker = true)`,
      ).toContain('security_invoker=true');
    }
  });

  it('hides another tenant rows through the profile view', async () => {
    const visible = await withTenant(db.appPool, alpha.tenantId, async (tx) => {
      const result = await tx.query<{ entity_id: string }>('SELECT entity_id FROM entity_profile');
      return result.rows;
    });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.entity_id).toBe(alpha.entityId);
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

    expect(roles.map((role) => role.rolname)).toEqual([
      'nx_app',
      'nx_auth',
      'nx_migrator',
      'nx_operator',
      'nx_retention',
    ]);
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
