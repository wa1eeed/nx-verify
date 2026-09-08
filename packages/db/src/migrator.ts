import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Client } from 'pg';
import { quoteIdentifier, quoteLiteral } from './sql-identifier.js';

/**
 * Migration runner.
 *
 * ADR-009: migrations are hand written SQL with a matching down file, applied by this
 * runner. drizzle-kit is not used to generate them, for three reasons. It emits no down
 * migration, and acceptance criterion 3 requires migrations to run both ways. It cannot
 * express roles, column level grants, FORCE ROW LEVEL SECURITY, policies or triggers,
 * which is most of what this schema actually is. And a generator invites push against a
 * live database, which is the wrong habit for an append only store.
 *
 * Drizzle remains the typed query layer. The schema drift test keeps the two in step.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export interface Migration {
  version: number;
  name: string;
  checksum: string;
  up: string;
  down: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const upFiles = readdirSync(dir)
    .filter((file) => file.endsWith('.up.sql'))
    .sort();

  const migrations = upFiles.map((file) => {
    const match = /^(\d{4})_([a-z0-9_]+)\.up\.sql$/.exec(file);
    if (!match?.[1] || !match[2]) {
      throw new Error(`migration file name does not follow NNNN_name.up.sql: ${file}`);
    }
    const version = Number.parseInt(match[1], 10);
    const name = match[2];
    const up = readFileSync(join(dir, file), 'utf8');
    const down = readFileSync(join(dir, `${match[1]}_${name}.down.sql`), 'utf8');
    return {
      version,
      name,
      checksum: createHash('sha256').update(up).digest('hex'),
      up,
      down,
    };
  });

  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`migration versions must be contiguous from 1, found ${migration.version}`);
    }
  });

  return migrations;
}

export async function ensureLedger(client: Client): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS nx_meta;
    CREATE TABLE IF NOT EXISTS nx_meta.schema_migrations (
      version    int PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function appliedMigrations(client: Client): Promise<AppliedMigration[]> {
  const { rows } = await client.query<AppliedMigration>(
    'SELECT version, name, checksum FROM nx_meta.schema_migrations ORDER BY version',
  );
  return rows;
}

function assertNoDrift(migrations: Migration[], applied: AppliedMigration[]): void {
  for (const record of applied) {
    const migration = migrations.find((candidate) => candidate.version === record.version);
    if (!migration) {
      throw new Error(`migration ${record.version} is applied but its file is missing`);
    }
    if (migration.checksum !== record.checksum) {
      throw new Error(
        `migration ${record.version} (${record.name}) changed after it was applied. ` +
          'Applied migrations are immutable. Add a new migration instead.',
      );
    }
  }
}

export interface MigrateOptions {
  to?: number;
  log?: (message: string) => void;
}

export async function migrateUp(client: Client, options: MigrateOptions = {}): Promise<number[]> {
  const log = options.log ?? (() => {});
  await ensureLedger(client);
  const migrations = loadMigrations();
  const applied = await appliedMigrations(client);
  assertNoDrift(migrations, applied);

  const appliedVersions = new Set(applied.map((record) => record.version));
  const target = options.to ?? Number.POSITIVE_INFINITY;
  const executed: number[] = [];

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version) || migration.version > target) {
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(migration.up);
      await client.query('RESET ROLE');
      await client.query(
        'INSERT INTO nx_meta.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, migration.checksum],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${migration.version} (${migration.name}) failed`, {
        cause: error,
      });
    }
    log(`up   ${String(migration.version).padStart(4, '0')} ${migration.name}`);
    executed.push(migration.version);
  }

  return executed;
}

export async function migrateDown(client: Client, options: MigrateOptions = {}): Promise<number[]> {
  const log = options.log ?? (() => {});
  await ensureLedger(client);
  const migrations = loadMigrations();
  const applied = await appliedMigrations(client);
  assertNoDrift(migrations, applied);

  const target = options.to ?? 0;
  const executed: number[] = [];

  for (const record of [...applied].reverse()) {
    if (record.version <= target) {
      continue;
    }
    const migration = migrations.find((candidate) => candidate.version === record.version);
    if (!migration) {
      throw new Error(`migration ${record.version} is applied but its file is missing`);
    }
    await client.query('BEGIN');
    try {
      await client.query(migration.down);
      await client.query('RESET ROLE');
      await client.query('DELETE FROM nx_meta.schema_migrations WHERE version = $1', [
        migration.version,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`rollback of migration ${migration.version} (${migration.name}) failed`, {
        cause: error,
      });
    }
    log(`down ${String(migration.version).padStart(4, '0')} ${migration.name}`);
    executed.push(migration.version);
  }

  return executed;
}

export interface RolePasswords {
  nx_migrator?: string | undefined;
  nx_app?: string | undefined;
  nx_retention?: string | undefined;
}

/**
 * Passwords live in the environment, never in a migration file and never in the ledger.
 * Migration 0001 creates the roles without any password, this assigns them.
 */
export async function setRolePasswords(client: Client, passwords: RolePasswords): Promise<void> {
  for (const [role, password] of Object.entries(passwords)) {
    if (!password) {
      continue;
    }
    await client.query(
      `ALTER ROLE ${quoteIdentifier(role)} WITH PASSWORD ${quoteLiteral(password)}`,
    );
  }
}
