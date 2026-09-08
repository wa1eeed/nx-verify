import type { Client } from 'pg';

/**
 * A deterministic description of everything migration 0001 through 0004 create.
 *
 * Used by `migrate verify` to prove that up, then down, then up again lands on exactly
 * the same schema. A rollback that silently leaves a policy or a grant behind is the
 * kind of defect that only shows up during an incident.
 */

const QUERIES: Record<string, string> = {
  columns: `
    SELECT c.relname AS table_name,
           a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attnotnull AS not_null,
           pg_get_expr(d.adbin, d.adrelid) AS default_expr
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attname
  `,
  constraints: `
    SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    ORDER BY c.relname, con.conname
  `,
  indexes: `
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `,
  row_level_security: `
    SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `,
  policies: `
    SELECT tablename, policyname, permissive, roles::text, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `,
  triggers: `
    SELECT c.relname AS table_name, t.tgname, pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  `,
  functions: `
    SELECT n.nspname AS schema_name, p.proname, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app'
    ORDER BY n.nspname, p.proname
  `,
  table_grants: `
    SELECT grantee, table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('nx_app', 'nx_retention', 'nx_migrator')
    ORDER BY grantee, table_name, privilege_type
  `,
  column_grants: `
    SELECT grantee, table_name, column_name, privilege_type
    FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND grantee IN ('nx_app', 'nx_retention', 'nx_migrator')
    ORDER BY grantee, table_name, column_name, privilege_type
  `,
  table_owners: `
    SELECT tablename, tableowner
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `,
  roles: `
    SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole
    FROM pg_roles
    WHERE rolname LIKE 'nx\\_%'
    ORDER BY rolname
  `,
};

export type SchemaSnapshot = Record<string, unknown[]>;

export async function snapshotSchema(client: Client): Promise<SchemaSnapshot> {
  const snapshot: SchemaSnapshot = {};
  for (const [key, sql] of Object.entries(QUERIES)) {
    const { rows } = await client.query(sql);
    snapshot[key] = rows;
  }
  return snapshot;
}

export function serializeSnapshot(snapshot: SchemaSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}
