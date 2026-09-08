import { sql } from 'drizzle-orm';
import { customType, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * Rule 1: this table is append only. The Drizzle definition exists for reading and for
 * inserting. Any update other than setting superseded_by once is refused by the database
 * itself, see migration 0004.
 */
export const attestations = pgTable('attestations', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  entityId: uuid('entity_id').notNull(),
  fieldPath: text('field_path').notNull(),
  value: jsonb('value').notNull(),
  valueHash: bytea('value_hash').notNull(),
  // Internal only. Rule 5: never exposed in a public response, which exposes authority.
  source: text('source').notNull(),
  authority: text('authority'),
  runId: uuid('run_id').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('1.000'),
  supersededBy: uuid('superseded_by'),
  evidenceId: uuid('evidence_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
