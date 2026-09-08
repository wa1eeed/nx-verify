import { sql } from 'drizzle-orm';
import { boolean, customType, pgTable, text, uuid } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * Rule 4: the hash is for lookup, the encrypted column is for display, and no column
 * here holds an identifier in the clear.
 */
export const entityIdentifiers = pgTable('entity_identifiers', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  entityId: uuid('entity_id').notNull(),
  idType: text('id_type').notNull(),
  idValueHash: bytea('id_value_hash').notNull(),
  idValueEnc: bytea('id_value_enc').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
});
