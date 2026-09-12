import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';

/**
 * The sandbox workspace.
 *
 * A customer's test traffic runs in a workspace of its own rather than behind a flag on
 * the real one, so isolation is row level security rather than a column every query has
 * to remember. See ADR-068.
 *
 * What a caller needs from this module is one boolean: is the workspace I am in a
 * sandbox. A screen uses it to say so, a sealed document uses it to stamp itself, and
 * neither has to know how the link is stored.
 */

export interface SandboxLink {
  tenantId: string;
  /** The real workspace this one is the sandbox of. Null when this workspace is real. */
  sandboxOf: string | null;
  isSandbox: boolean;
}

export async function sandboxLink(tx: TenantTransaction): Promise<SandboxLink> {
  const { rows } = await tx.query<{ id: string; sandbox_of: string | null }>(
    `SELECT id, sandbox_of FROM tenants WHERE id = $1`,
    [tx.tenantId],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', { detail: 'no such workspace' });
  }
  return { tenantId: row.id, sandboxOf: row.sandbox_of, isSandbox: row.sandbox_of !== null };
}

export async function isSandbox(tx: TenantTransaction): Promise<boolean> {
  return (await sandboxLink(tx)).isSandbox;
}

/**
 * Finds a workspace's sandbox, on a connection that can cross workspaces.
 *
 * Used by provisioning and by the operator panel. A subscriber never needs this: they are
 * in one workspace or the other, and the key they used decided which.
 */
export async function findSandboxOf(
  operator: Queryable,
  tenantId: string,
): Promise<string | null> {
  const { rows } = await operator.query<{ id: string }>(
    `SELECT id FROM tenants WHERE sandbox_of = $1`,
    [tenantId],
  );
  return rows[0]?.id ?? null;
}
