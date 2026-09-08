import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Rule 10: credential_ref is a KMS pointer. No credential is stored in this database. */
export const tenantProviderBinding = pgTable('tenant_provider_binding', {
  tenantId: uuid('tenant_id').notNull(),
  provider: text('provider').notNull(),
  mode: text('mode').notNull(),
  credentialRef: text('credential_ref'),
  rateLimitRps: integer('rate_limit_rps').notNull().default(5),
  healthStatus: text('health_status').notNull().default('unknown'),
  lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
});
