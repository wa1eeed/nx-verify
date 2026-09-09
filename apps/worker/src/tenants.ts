import type { Queryable } from '@nx-verify/db';

/**
 * The list of workspaces the scheduler walks.
 *
 * This is the one query in the worker that is not scoped to a tenant, and it is read on
 * the operator connection rather than the application one. That is the same argument
 * ADR-023 makes for the provider panel: crossing subscribers is allowed for configuration
 * and never for their data, so the crossing is done by a role that can see nothing but
 * configuration, and everything the jobs then do runs under one workspace at a time
 * through withTenant.
 *
 * A worker that listed tenants on the application connection would have needed a policy
 * widening nx_app, and rule 2 would have been one forgotten WHERE away from breaking.
 */
export async function activeTenantIds(operator: Queryable): Promise<string[]> {
  const { rows } = await operator.query<{ id: string }>(
    `SELECT id FROM tenants WHERE status = 'active' ORDER BY created_at`,
  );
  return rows.map((row) => row.id);
}
