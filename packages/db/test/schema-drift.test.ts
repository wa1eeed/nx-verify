import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';
import { attestations, entities, tenants } from '../src/schema/index.js';

/**
 * ADR-009 leaves the SQL migrations as the single source of truth and keeps Drizzle as a
 * hand written typed view over them. That split only holds if something checks it, so
 * this test introspects the migrated database and compares it to the Drizzle definitions.
 *
 * It replaces the `drizzle-kit pull` snapshot comparison from the plan. Comparing against
 * the live catalog is stricter and adds no dependency.
 */

const TABLES: PgTable[] = [tenants, entities, attestations];

/** Both sides describe the same type in slightly different words. */
function normalizeType(type: string): string {
  return type
    .toLowerCase()
    .replaceAll(' ', '')
    .replace(/^character\(/, 'char(')
    .replace(/^charactervarying/, 'varchar')
    .replace(/^timestamp\((\d)\)withtimezone$/, 'timestamptz')
    .replace(/^timestampwithtimezone$/, 'timestamptz');
}

interface CatalogColumn {
  column_name: string;
  data_type: string;
  not_null: boolean;
  has_default: boolean;
}

describe('drizzle schema matches the migrated database', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  for (const table of TABLES) {
    const config = getTableConfig(table);

    it(`${config.name} has the same columns in both definitions`, async () => {
      const { rows } = await db.migratorPool.query<CatalogColumn>(
        `SELECT a.attname AS column_name,
                format_type(a.atttypid, a.atttypmod) AS data_type,
                a.attnotnull AS not_null,
                a.atthasdef AS has_default
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attname`,
        [config.name],
      );

      const fromDatabase = rows.map((row) => ({
        name: row.column_name,
        type: normalizeType(row.data_type),
        notNull: row.not_null,
        hasDefault: row.has_default,
      }));

      const fromDrizzle = config.columns
        .map((column) => ({
          name: column.name,
          type: normalizeType(column.getSQLType()),
          notNull: column.notNull,
          hasDefault: column.hasDefault,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));

      expect(fromDrizzle).toEqual(fromDatabase);
    });
  }
});
