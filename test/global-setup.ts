import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { migrateUp, setRolePasswords } from '../packages/db/src/migrator.js';
import { POSTGRES_IMAGE } from '../packages/db/src/postgres-version.js';
import { TEMPLATE_DATABASE, TEST_ROLE_PASSWORDS } from './helpers/constants.js';
import type { GlobalSetupContext } from 'vitest/node';

/**
 * Rule 11: one real PostgreSQL container at the pinned production version, started once
 * for the whole run. Nothing in this repository tests the database layer against SQLite,
 * an in memory stand in, or a mock. Row level security is a PostgreSQL feature, and an
 * isolation test that does not run on PostgreSQL proves nothing.
 *
 * Migrations are applied once to a template database. Each test file clones it, so every
 * suite gets a pristine schema without paying for a container or a migration run.
 */

let container: StartedPostgreSqlContainer | undefined;

export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const baseUrl = container.getConnectionUri();

  const bootstrap = new pg.Client({ connectionString: baseUrl });
  await bootstrap.connect();
  await bootstrap.query(`CREATE DATABASE ${TEMPLATE_DATABASE}`);
  await bootstrap.end();

  const templateUrl = new URL(baseUrl);
  templateUrl.pathname = `/${TEMPLATE_DATABASE}`;

  const migrator = new pg.Client({ connectionString: templateUrl.toString() });
  await migrator.connect();
  await migrateUp(migrator);
  await setRolePasswords(migrator, TEST_ROLE_PASSWORDS);
  await migrator.end();

  provide('pgBaseUrl', baseUrl);
  provide('templateDatabase', TEMPLATE_DATABASE);

  return async () => {
    await container?.stop();
  };
}
