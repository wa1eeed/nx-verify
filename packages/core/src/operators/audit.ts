import type { Queryable } from '@nx-verify/db';
import { readPage, type Page, type PageRequest } from '../pagination.js';

/**
 * What staff changed, and who changed it (handoff screen 05, «آخر تعديل بواسطة»).
 *
 * The trail is appended to and read, never edited. Each row names the account that made
 * the change by its id, and the reader joins the name, so renaming a member of staff does
 * not rewrite history and a disabled account still says who it was.
 */

export interface OperatorAuditEntry {
  operatorId: string;
  action: string;
  target: string;
  /** What changed, described: field names and values, never material. */
  metadata?: Record<string, unknown>;
}

export interface OperatorAuditRow extends Required<OperatorAuditEntry> {
  at: Date;
  /** The member of staff's name, or null for the deployment's token. */
  operatorName: string | null;
}

export async function recordOperatorAudit(db: Queryable, entry: OperatorAuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO operator_audit (operator_id, action, target, metadata) VALUES ($1, $2, $3, $4::jsonb)`,
    [entry.operatorId, entry.action, entry.target, JSON.stringify(entry.metadata ?? {})],
  );
}

/**
 * Changes newest first: all of them, or those whose target or action starts with one of the
 * prefixes given. A target prefix narrows to one thing («pricing:»); an action prefix to one
 * kind of change («staff.»).
 */
export interface OperatorAuditFilter {
  targetPrefixes?: readonly string[];
  actionPrefixes?: readonly string[];
}

const AUDIT_FILTER = `(cardinality($1::text[]) = 0 AND cardinality($2::text[]) = 0)
        OR EXISTS (SELECT 1 FROM unnest($1::text[]) AS prefix WHERE a.target LIKE prefix || '%')
        OR EXISTS (SELECT 1 FROM unnest($2::text[]) AS prefix WHERE a.action LIKE prefix || '%')`;

/** How many changes the prefixes leave, for the pages of the trail. */
export async function countOperatorAudit(
  db: Queryable,
  filter: OperatorAuditFilter = {},
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM operator_audit a WHERE ${AUDIT_FILTER}`,
    [[...(filter.targetPrefixes ?? [])], [...(filter.actionPrefixes ?? [])]],
  );
  return Number(rows[0]?.count ?? 0);
}

/** One page of the trail, newest first. */
export async function pageOperatorAudit(
  db: Queryable,
  filter: OperatorAuditFilter,
  request: PageRequest,
): Promise<Page<OperatorAuditRow>> {
  return readPage(
    request,
    () => countOperatorAudit(db, filter),
    (window) => listOperatorAudit(db, { ...filter, ...window }),
  );
}

export async function listOperatorAudit(
  db: Queryable,
  options: OperatorAuditFilter & { limit?: number; offset?: number } = {},
): Promise<OperatorAuditRow[]> {
  const targets = options.targetPrefixes ?? [];
  const actions = options.actionPrefixes ?? [];
  const { rows } = await db.query<{
    at: Date;
    operator_id: string;
    operator_name: string | null;
    action: string;
    target: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT a.at, a.operator_id, o.display_name AS operator_name, a.action, a.target, a.metadata
     FROM operator_audit a
     LEFT JOIN operator_accounts o ON o.id::text = a.operator_id
     WHERE ${AUDIT_FILTER}
     ORDER BY a.at DESC, a.id DESC
     LIMIT $3 OFFSET $4`,
    [
      [...targets],
      [...actions],
      Math.min(Math.max(options.limit ?? 50, 1), 500),
      Math.max(options.offset ?? 0, 0),
    ],
  );
  return rows.map((row) => ({
    at: row.at,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    action: row.action,
    target: row.target,
    metadata: row.metadata,
  }));
}
