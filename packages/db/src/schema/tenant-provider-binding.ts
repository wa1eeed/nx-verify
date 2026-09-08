import { customType, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const textArray = customType<{ data: string[]; driverData: string[] }>({
  dataType: () => 'text[]',
});

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
  /** Lower runs first. A subscriber may be bound to several providers (ADR-043). */
  priority: integer('priority').notNull().default(100),
  /** NULL means every endpoint this provider serves. */
  endpoints: textArray('endpoints'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
