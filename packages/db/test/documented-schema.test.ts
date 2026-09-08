import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * The schema documents describe the schema that exists.
 *
 * docs/02-schema.md and docs/03-products.md are read at the start of every session and
 * are the first thing a new person trusts. Six of their claims turned out to be wrong
 * during the build, and each one was corrected against what was implemented rather than
 * the other way around. This checks that the corrections still hold, so the next drift
 * is caught by a test rather than by someone acting on a stale document.
 *
 * It asserts the claims that were wrong, not every line of the documents. A test that
 * mirrored the whole schema would be a second copy of it, and two copies drift.
 */

const SCHEMA_DOC = readFileSync(
  fileURLToPath(new URL('../../../docs/02-schema.md', import.meta.url)),
  'utf8',
);
const PRODUCTS_DOC = readFileSync(
  fileURLToPath(new URL('../../../docs/03-products.md', import.meta.url)),
  'utf8',
);

describe('the documents describe the schema that exists', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  const ask = async (sql: string, params: unknown[] = []): Promise<boolean> => {
    const { rows } = await db.migratorPool.query<{ ok: boolean | null }>(sql, params);
    return rows[0]?.ok === true;
  };

  it('immutability is triggers, and no rewrite rule survives', async () => {
    // The document used to show CREATE RULE ... DO INSTEAD NOTHING (ADR-010).
    expect(SCHEMA_DOC).not.toContain('att_no_update');
    expect(SCHEMA_DOC).toContain('attestations_forbid_update');

    expect(
      await ask(
        `SELECT count(*) = 2 AS ok FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         WHERE c.relname = 'attestations' AND NOT t.tgisinternal`,
      ),
    ).toBe(true);
    expect(
      await ask(
        `SELECT count(*) = 0 AS ok FROM pg_rules
         WHERE tablename = 'attestations' AND rulename <> '_RETURN'`,
      ),
    ).toBe(true);
  });

  it('freshness is computed, and the warning window scales with the TTL', async () => {
    // ADR-012 and ADR-013.
    expect(SCHEMA_DOC).toContain('app.freshness_state');
    expect(SCHEMA_DOC).toContain('effective_until');

    expect(
      await ask(
        `SELECT pg_get_function_identity_arguments(p.oid)
                = 'effective_until timestamp with time zone, ttl_days integer' AS ok
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'app' AND p.proname = 'freshness_state'`,
      ),
    ).toBe(true);

    // The projection exposes what is computed and no longer the stored expiry.
    expect(
      await ask(
        `SELECT bool_and(present) AS ok FROM (
           SELECT 'effective_until' IN (SELECT column_name FROM information_schema.columns
             WHERE table_name = 'entity_profile') AS present
           UNION ALL SELECT 'ttl_days' IN (SELECT column_name FROM information_schema.columns
             WHERE table_name = 'entity_profile')
           UNION ALL SELECT 'valid_until' NOT IN (SELECT column_name FROM information_schema.columns
             WHERE table_name = 'entity_profile')
         ) t`,
      ),
    ).toBe(true);
  });

  it('the profile view is a security invoker view', async () => {
    expect(SCHEMA_DOC).toContain('security_invoker = true');
    expect(
      await ask(
        `SELECT 'security_invoker=true' = ANY(reloptions) AS ok
         FROM pg_class WHERE relname = 'entity_profile'`,
      ),
    ).toBe(true);
  });

  it('the retention policy key is a unique index, since the documented primary key was not valid SQL', async () => {
    expect(SCHEMA_DOC).toContain('CREATE UNIQUE INDEX uq_freshness_policy');
    expect(SCHEMA_DOC).toContain('portfolio_id');

    expect(
      await ask(
        `SELECT indexdef LIKE 'CREATE UNIQUE INDEX%' AS ok
         FROM pg_indexes WHERE indexname = 'uq_freshness_policy'`,
      ),
    ).toBe(true);
    expect(
      await ask(
        `SELECT count(*) = 3 AS ok FROM information_schema.columns
         WHERE table_name = 'freshness_policy'
           AND column_name IN ('tenant_id', 'portfolio_id', 'field_path')`,
      ),
    ).toBe(true);
  });

  it('the ledger carries HOLD and RELEASE, and the wallet carries held', async () => {
    // ADR-019.
    expect(SCHEMA_DOC).toContain('HOLD | RELEASE');
    expect(SCHEMA_DOC).toContain('held ');

    expect(
      await ask(
        `SELECT pg_get_constraintdef(oid) LIKE '%HOLD%'
            AND pg_get_constraintdef(oid) LIKE '%RELEASE%' AS ok
         FROM pg_constraint WHERE conname = 'wallet_ledger_reason_check'`,
      ),
    ).toBe(true);
    expect(
      await ask(
        `SELECT count(*) = 1 AS ok FROM information_schema.columns
         WHERE table_name = 'wallets' AND column_name = 'held'`,
      ),
    ).toBe(true);
  });

  it('retention destroys identifiers rather than editing an attestation', async () => {
    // ADR-028. The document no longer promises a tombstone on a live attestation.
    expect(SCHEMA_DOC).toContain('entity_identifiers');
    expect(SCHEMA_DOC).toContain('archived_at');

    // And the retention role has exactly the grants that plan needs.
    expect(
      await ask(
        `SELECT count(*) = 2 AS ok FROM information_schema.role_table_grants
         WHERE grantee = 'nx_retention'
           AND ((table_name = 'audit_log' AND privilege_type = 'INSERT')
             OR (table_name = 'entity_identifiers' AND privilege_type = 'DELETE'))`,
      ),
    ).toBe(true);
  });

  it('the field map has no ttl_override, and names the identifier type', async () => {
    // ADR-017 and ADR-018. The column is gone from the table definition, while the note
    // explaining why it went is expected to name it.
    // The table definition alone, bounded by the end of its code fence.
    const start = PRODUCTS_DOC.indexOf('CREATE TABLE step_field_map');
    const definition = PRODUCTS_DOC.slice(start, PRODUCTS_DOC.indexOf('```', start));
    expect(definition).not.toContain('ttl_override');
    expect(definition).toContain('identifier_type_source');
    expect(PRODUCTS_DOC).toContain('حُذف `ttl_override`');

    expect(
      await ask(
        `SELECT count(*) = 0 AS ok FROM information_schema.columns
         WHERE table_name = 'step_field_map' AND column_name = 'ttl_override'`,
      ),
    ).toBe(true);
    expect(
      await ask(
        `SELECT count(*) = 3 AS ok FROM information_schema.columns
         WHERE table_name = 'step_field_map'
           AND column_name IN ('identifier_type_source', 'valid_until_path', 'confidence')`,
      ),
    ).toBe(true);
    expect(
      await ask(
        `SELECT count(*) = 1 AS ok FROM pg_constraint
         WHERE conname = 'ck_secondary_entity_is_resolvable'`,
      ),
    ).toBe(true);
  });

  it('every table the documents show in SQL actually exists', async () => {
    const documented = new Set<string>();
    for (const doc of [SCHEMA_DOC, PRODUCTS_DOC]) {
      for (const match of doc.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)) {
        if (match[1]) {
          documented.add(match[1]);
        }
      }
    }

    const { rows } = await db.migratorPool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const actual = new Set(rows.map((row) => row.tablename));

    // product_map is the one table the products document explicitly retires.
    const retired = new Set(['product_map']);
    const missing = [...documented].filter((table) => !actual.has(table) && !retired.has(table));

    expect(missing).toEqual([]);
  });
});
