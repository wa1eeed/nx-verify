import { sql } from 'drizzle-orm';
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  legalName: text('legal_name').notNull(),
  crNumber: text('cr_number'),
  status: text('status').notNull().default('active'),
  dataRegion: text('data_region').notNull().default('ksa'),
  retentionDays: integer('retention_days').notNull().default(1825),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
