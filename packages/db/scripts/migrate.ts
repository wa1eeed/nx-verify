import pg from 'pg';
import {
  migrateDown,
  migrateUp,
  appliedMigrations,
  loadMigrations,
  setRolePasswords,
} from '../src/migrator.js';
import { serializeSnapshot, snapshotSchema } from '../src/schema-snapshot.js';
import { POSTGRES_IMAGE } from '../src/postgres-version.js';

/**
 * Migration CLI.
 *
 *   migrate up [--to N]      apply pending migrations
 *   migrate down [--to N]    roll back to version N, default 0
 *   migrate status           show what is applied
 *   migrate verify           up, down, up again, and prove the schema is identical
 *
 * Add --container to run against a throwaway PostgreSQL container at the pinned version
 * instead of NX_ADMIN_DATABASE_URL. This is what CI uses, so CI and local runs exercise
 * exactly the same database (rule 11).
 */

const log = (message: string): void => {
  console.log(message);
};

async function connect(connectionString: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

async function withContainer<T>(handler: (url: string) => Promise<T>): Promise<T> {
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  log(`starting ${POSTGRES_IMAGE}`);
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  try {
    return await handler(container.getConnectionUri());
  } finally {
    await container.stop();
  }
}

async function commandUp(client: pg.Client, to?: number): Promise<void> {
  const executed = await migrateUp(client, { log, ...(to === undefined ? {} : { to }) });
  if (executed.length === 0) {
    log('nothing to apply');
  }
  await setRolePasswords(client, {
    nx_migrator: process.env['NX_MIGRATOR_PASSWORD'],
    nx_app: process.env['NX_APP_PASSWORD'],
    nx_retention: process.env['NX_RETENTION_PASSWORD'],
  });
}

async function commandDown(client: pg.Client, to?: number): Promise<void> {
  const executed = await migrateDown(client, { log, ...(to === undefined ? {} : { to }) });
  if (executed.length === 0) {
    log('nothing to roll back');
  }
}

async function commandStatus(client: pg.Client): Promise<void> {
  const migrations = loadMigrations();
  const applied = new Map((await appliedMigrations(client)).map((row) => [row.version, row]));
  for (const migration of migrations) {
    const mark = applied.has(migration.version) ? 'applied' : 'pending';
    log(`${String(migration.version).padStart(4, '0')} ${mark.padEnd(8)} ${migration.name}`);
  }
}

async function commandVerify(client: pg.Client): Promise<void> {
  log('pass 1: up');
  await migrateUp(client, { log });
  const first = serializeSnapshot(await snapshotSchema(client));

  log('pass 2: down');
  await migrateDown(client, { log });
  const { rows: leftovers } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM pg_tables
     WHERE schemaname = 'public'`,
  );
  if (leftovers[0]?.count !== '0') {
    throw new Error(`rollback left ${leftovers[0]?.count} table(s) behind in the public schema`);
  }
  const { rows: schemas } = await client.query<{ nspname: string }>(
    "SELECT nspname FROM pg_namespace WHERE nspname = 'app'",
  );
  if (schemas.length > 0) {
    throw new Error('rollback left the app schema behind');
  }
  const { rows: roles } = await client.query<{ rolname: string }>(
    "SELECT rolname FROM pg_roles WHERE rolname LIKE 'nx\\_%'",
  );
  if (roles.length > 0) {
    throw new Error(`rollback left roles behind: ${roles.map((r) => r.rolname).join(', ')}`);
  }

  log('pass 3: up again');
  await migrateUp(client, { log });
  const second = serializeSnapshot(await snapshotSchema(client));

  if (first !== second) {
    throw new Error('schema after down and up again differs from the schema after the first up');
  }
  log('verify ok: up, down and up again produce an identical schema');
}

async function run(command: string, client: pg.Client, to?: number): Promise<void> {
  switch (command) {
    case 'up':
      await commandUp(client, to);
      return;
    case 'down':
      await commandDown(client, to);
      return;
    case 'status':
      await commandStatus(client);
      return;
    case 'verify':
      await commandVerify(client);
      return;
    default:
      throw new Error(`unknown command: ${command}. Use up, down, status or verify.`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'status';
  const useContainer = args.includes('--container');
  const toIndex = args.indexOf('--to');
  const to = toIndex === -1 ? undefined : Number.parseInt(args[toIndex + 1] ?? '', 10);
  if (to !== undefined && Number.isNaN(to)) {
    throw new Error('--to requires a migration version number');
  }

  if (useContainer) {
    await withContainer(async (url) => {
      const client = await connect(url);
      try {
        await run(command, client, to);
      } finally {
        await client.end();
      }
    });
    return;
  }

  const url = process.env['NX_ADMIN_DATABASE_URL'];
  if (!url) {
    throw new Error(
      'NX_ADMIN_DATABASE_URL is not set. Add --container to use a throwaway database.',
    );
  }
  const client = await connect(url);
  try {
    await run(command, client, to);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
