export { createPool, withTenant, withoutTenant } from './client.js';
export type { TenantTransaction } from './client.js';
export { assertUuid } from './sql-identifier.js';
export { POSTGRES_IMAGE, POSTGRES_MAJOR_VERSION } from './postgres-version.js';
export {
  appliedMigrations,
  ensureLedger,
  loadMigrations,
  migrateDown,
  migrateUp,
  setRolePasswords,
} from './migrator.js';
export type { Migration, AppliedMigration, RolePasswords } from './migrator.js';
export { snapshotSchema, serializeSnapshot } from './schema-snapshot.js';
export type { SchemaSnapshot } from './schema-snapshot.js';
export * as schema from './schema/index.js';
