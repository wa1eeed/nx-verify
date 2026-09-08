import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { audit } from '../auth/audit.js';
import { canApprove, canDecide, getUser } from '../auth/users.js';

/**
 * The review queue.
 *
 * Every REVIEW decision opens a case, and a case is finished by two people: one decides,
 * another approves. The separation is enforced by the database, not here, because a
 * control that lives only in application code is a control that a hotfix removes.
 *
 * decision_note is the one free text field rule 6 permits, and the wording of that rule
 * matters: it is a note about a decision we made, never a note about the customer's
 * client. That distinction is the whole line between this product and a CRM.
 */

export type CaseStatus = 'OPEN' | 'ASSIGNED' | 'DECIDED' | 'CLOSED';
export type CaseOutcome = 'PASS' | 'FAIL';
export type CasePriority = 'LOW' | 'NORMAL' | 'HIGH';

export interface OpenCaseInput {
  entityId: string;
  runId: string;
  reasonCodes: string[];
  priority?: CasePriority;
}

export async function openCase(
  tx: TenantTransaction,
  input: OpenCaseInput,
): Promise<string | null> {
  const { rows: tenantRows } = await tx.query<{ review_sla_hours: number }>(
    `SELECT review_sla_hours FROM tenants WHERE id = $1`,
    [tx.tenantId],
  );
  const slaHours = tenantRows[0]?.review_sla_hours ?? 48;

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO review_cases (tenant_id, entity_id, run_id, reason_codes, priority, sla_due_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))
     ON CONFLICT (tenant_id, run_id) DO NOTHING
     RETURNING id`,
    [
      tx.tenantId,
      input.entityId,
      input.runId,
      input.reasonCodes,
      input.priority ?? 'NORMAL',
      slaHours,
    ],
  );

  // A repeat verification of the same run does not stack a second case on a queue.
  return rows[0]?.id ?? null;
}

export interface QueueItem {
  caseId: string;
  entityId: string;
  runId: string;
  status: CaseStatus;
  reasonCodes: string[];
  priority: CasePriority;
  assignedTo: string | null;
  outcome: CaseOutcome | null;
  decidedBy: string | null;
  decisionNote: string | null;
  slaDueAt: Date;
  openedAt: Date;
  /** Hours since the case opened. The number a queue is actually managed by. */
  ageHours: number;
  overdue: boolean;
}

export interface QueueFilter {
  status?: CaseStatus | 'AWAITING_APPROVAL';
  assignedTo?: string;
  entityId?: string;
  limit?: number;
}

export async function listQueue(
  tx: TenantTransaction,
  filter: QueueFilter = {},
): Promise<QueueItem[]> {
  const status = filter.status === 'AWAITING_APPROVAL' ? 'DECIDED' : (filter.status ?? null);

  const { rows } = await tx.query<{
    id: string;
    entity_id: string;
    run_id: string;
    status: CaseStatus;
    reason_codes: string[];
    priority: CasePriority;
    assigned_to: string | null;
    outcome: CaseOutcome | null;
    decided_by: string | null;
    decision_note: string | null;
    sla_due_at: Date;
    opened_at: Date;
    age_hours: string;
    overdue: boolean;
  }>(
    `SELECT id, entity_id, run_id, status, reason_codes, priority, assigned_to, outcome,
            decided_by, decision_note, sla_due_at, opened_at,
            (extract(epoch FROM (now() - opened_at)) / 3600)::numeric(10,2)::text AS age_hours,
            (sla_due_at < now() AND closed_at IS NULL) AS overdue
     FROM review_cases
     WHERE tenant_id = $1
       AND ($2::text IS NULL OR status = $2)
       AND ($3::uuid IS NULL OR assigned_to = $3)
       AND ($4::uuid IS NULL OR entity_id = $4)
     ORDER BY
       (sla_due_at < now() AND closed_at IS NULL) DESC,
       CASE priority WHEN 'HIGH' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END,
       sla_due_at
     LIMIT $5`,
    [tx.tenantId, status, filter.assignedTo ?? null, filter.entityId ?? null, filter.limit ?? 100],
  );

  return rows.map((row) => ({
    caseId: row.id,
    entityId: row.entity_id,
    runId: row.run_id,
    status: row.status,
    reasonCodes: row.reason_codes,
    priority: row.priority,
    assignedTo: row.assigned_to,
    outcome: row.outcome,
    decidedBy: row.decided_by,
    decisionNote: row.decision_note,
    slaDueAt: row.sla_due_at,
    openedAt: row.opened_at,
    ageHours: Number(row.age_hours),
    overdue: row.overdue,
  }));
}

export async function assignCase(
  tx: TenantTransaction,
  caseId: string,
  assignee: string,
): Promise<void> {
  await requireUser(tx, assignee);

  const { rowCount } = await tx.query(
    `UPDATE review_cases
     SET assigned_to = $3, assigned_at = now(), status = 'ASSIGNED'
     WHERE tenant_id = $1 AND id = $2 AND status IN ('OPEN', 'ASSIGNED')`,
    [tx.tenantId, caseId, assignee],
  );

  if (rowCount === 0) {
    throw new NxError('NX-4002', { detail: 'this case cannot be assigned in its current state' });
  }

  await audit(tx, {
    actorType: 'USER',
    actorId: assignee,
    action: 'review.assigned',
    target: caseId,
  });
}

export interface DecideCaseInput {
  caseId: string;
  outcome: CaseOutcome;
  decidedBy: string;
  /** Required. A decision with no stated reason is not reviewable later. */
  note: string;
}

export async function decideCase(tx: TenantTransaction, input: DecideCaseInput): Promise<void> {
  if (input.note.trim().length === 0) {
    throw new NxError('NX-4001', { detail: 'a review decision needs a written reason' });
  }

  // The trigger in migration 0018 refuses a viewer too. This gives the refusal our own
  // code and a message a person can act on.
  const decider = await requireUser(tx, input.decidedBy);
  if (!canDecide(decider.role)) {
    throw new NxError('NX-4031', { detail: 'this role cannot decide a review case' });
  }

  const { rowCount } = await tx.query(
    `UPDATE review_cases
     SET outcome = $3, decided_by = $4, decided_at = now(), decision_note = $5, status = 'DECIDED'
     WHERE tenant_id = $1 AND id = $2 AND status IN ('OPEN', 'ASSIGNED')`,
    [tx.tenantId, input.caseId, input.outcome, input.decidedBy, input.note.trim()],
  );

  if (rowCount === 0) {
    throw new NxError('NX-4002', { detail: 'this case cannot be decided in its current state' });
  }

  await audit(tx, {
    actorType: 'USER',
    actorId: input.decidedBy,
    action: 'review.decided',
    target: input.caseId,
    metadata: { outcome: input.outcome },
  });
}

/**
 * The second pair of eyes.
 *
 * The database refuses an approver who is the decider, so this does not have to be
 * trusted to check. It reports the refusal in our own terms rather than letting a
 * constraint violation reach a caller.
 */
export async function approveCase(
  tx: TenantTransaction,
  caseId: string,
  approver: string,
): Promise<void> {
  const { rows } = await tx.query<{ decided_by: string | null; status: CaseStatus }>(
    `SELECT decided_by, status FROM review_cases WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, caseId],
  );

  const found = rows[0];
  if (!found) {
    throw new NxError('NX-4041', { detail: 'no such case' });
  }
  if (found.status !== 'DECIDED') {
    throw new NxError('NX-4002', { detail: 'only a decided case can be approved' });
  }
  if (found.decided_by === approver) {
    throw new NxError('NX-4031', {
      detail: 'the person who decided a case cannot also approve it',
    });
  }

  const signer = await requireUser(tx, approver);
  if (!canApprove(signer.role)) {
    throw new NxError('NX-4031', { detail: 'this role cannot approve a review case' });
  }

  await tx.query(
    `UPDATE review_cases
     SET approved_by = $3, approved_at = now(), status = 'CLOSED', closed_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status = 'DECIDED'`,
    [tx.tenantId, caseId, approver],
  );

  await audit(tx, {
    actorType: 'USER',
    actorId: approver,
    action: 'review.approved',
    target: caseId,
  });
}

/** Sends a decided case back, with the reason it was sent back. */
async function requireUser(tx: TenantTransaction, userId: string) {
  const user = await getUser(tx, userId);
  if (!user || user.status !== 'active') {
    throw new NxError('NX-4041', { detail: 'no such active user in this tenant' });
  }
  return user;
}

export async function returnCase(
  tx: TenantTransaction,
  caseId: string,
  approver: string,
  reason: string,
): Promise<void> {
  const { rowCount } = await tx.query(
    `UPDATE review_cases
     SET status = 'OPEN', outcome = NULL, decided_by = NULL, decided_at = NULL,
         decision_note = NULL
     WHERE tenant_id = $1 AND id = $2 AND status = 'DECIDED'`,
    [tx.tenantId, caseId],
  );

  if (rowCount === 0) {
    throw new NxError('NX-4002', { detail: 'only a decided case can be returned' });
  }

  await audit(tx, {
    actorType: 'USER',
    actorId: approver,
    action: 'review.returned',
    target: caseId,
    metadata: { reason },
  });
}

export interface QueueStats {
  open: number;
  assigned: number;
  awaitingApproval: number;
  closed: number;
  overdue: number;
  /** Median hours from opening to closing, for the periodic report. */
  medianHoursToClose: number | null;
}

export async function queueStats(tx: TenantTransaction): Promise<QueueStats> {
  const { rows } = await tx.query<{
    open: string;
    assigned: string;
    awaiting: string;
    closed: string;
    overdue: string;
    median_hours: string | null;
  }>(
    `SELECT
       count(*) FILTER (WHERE status = 'OPEN')::text AS open,
       count(*) FILTER (WHERE status = 'ASSIGNED')::text AS assigned,
       count(*) FILTER (WHERE status = 'DECIDED')::text AS awaiting,
       count(*) FILTER (WHERE status = 'CLOSED')::text AS closed,
       count(*) FILTER (WHERE sla_due_at < now() AND closed_at IS NULL)::text AS overdue,
       percentile_cont(0.5) WITHIN GROUP (
         ORDER BY extract(epoch FROM (closed_at - opened_at)) / 3600
       ) FILTER (WHERE closed_at IS NOT NULL)::text AS median_hours
     FROM review_cases
     WHERE tenant_id = $1`,
    [tx.tenantId],
  );

  const row = rows[0];
  return {
    open: Number(row?.open ?? 0),
    assigned: Number(row?.assigned ?? 0),
    awaitingApproval: Number(row?.awaiting ?? 0),
    closed: Number(row?.closed ?? 0),
    overdue: Number(row?.overdue ?? 0),
    medianHoursToClose: row?.median_hours == null ? null : Number(row.median_hours),
  };
}
