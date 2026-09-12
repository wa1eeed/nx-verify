import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { appliedMigrations, migrateDown, migrateUp } from '../src/migrator.js';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * The ledger refuses an edited migration, and still lets you undo one.
 *
 * Both halves matter. Without the refusal, a schema can silently differ from the file
 * that claims to describe it. Without the rollback, a developer who edited an unreleased
 * migration can neither apply it nor undo it, and the only way out is to drop the
 * database, which on a shared development instance means somebody else's data.
 */

describe('the migration ledger', () => {
  let db: TestDatabase;
  let client: pg.Client;

  beforeAll(async () => {
    db = await createTestDatabase();
    // The ledger belongs to the role a deployment migrates with, not to nx_migrator,
    // which each migration enters with SET LOCAL ROLE.
    client = new pg.Client({ connectionString: db.adminConnectionString });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await db.close();
  });

  it('refuses to apply anything once a migration has been edited', async () => {
    {
      const applied = await appliedMigrations(client);
      const newest = applied[applied.length - 1];
      expect(newest).toBeDefined();

      // Exactly what editing an applied migration file looks like to the ledger.
      await client.query('UPDATE nx_meta.schema_migrations SET checksum = $1 WHERE version = $2', [
        'not-the-checksum-of-that-file',
        newest?.version,
      ]);

      await expect(migrateUp(client)).rejects.toThrow(/changed after it was applied/);
      // And it says what to do about it, rather than leaving the reader to guess.
      await expect(migrateUp(client)).rejects.toThrow(/migrate down/);
    }
  });

  it('still rolls back the migration that was edited', async () => {
    {
      const applied = await appliedMigrations(client);
      const newest = applied[applied.length - 1];
      const target = (newest?.version ?? 1) - 1;

      // The checksum is still wrong from the test above. Rolling back is the recovery,
      // so it must work: what the ledger protects is the schema left behind.
      const undone = await migrateDown(client, { to: target });
      expect(undone).toEqual([newest?.version]);

      // And now that the edited one is gone, applying forward works again.
      const reapplied = await migrateUp(client);
      expect(reapplied).toEqual([newest?.version]);
    }
  });
});
