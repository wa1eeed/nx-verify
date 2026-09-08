/**
 * Migration tooling entry point.
 *
 * Kept out of the package index on purpose. The migrator resolves the migrations
 * directory from disk, which is right for a CLI and meaningless to anything that bundles
 * the package, such as the console. Runtime consumers get the client, the schema and the
 * seed; migration tooling asks for it by name.
 */
export {
  appliedMigrations,
  ensureLedger,
  loadMigrations,
  migrateDown,
  migrateUp,
  setRolePasswords,
} from './migrator.js';
export type { AppliedMigration, Migration, MigrateOptions, RolePasswords } from './migrator.js';
export { serializeSnapshot, snapshotSchema } from './schema-snapshot.js';
export type { SchemaSnapshot } from './schema-snapshot.js';
