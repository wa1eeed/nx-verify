import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { queueEventTo, type WebhookEventType } from '../webhooks/dispatch.js';
import { queueNotificationTo } from '../notifications/notifications.js';
import type { CaseStatus, OnboardingCase } from './cases.js';

/**
 * What happens after a file is decided.
 *
 * A verification platform ends at the answer. An onboarding platform does not: an
 * approved merchant has to be activated somewhere, a rejected one has to reach the person
 * who will talk to them, and a file sent to review has to land in front of somebody.
 *
 * This module builds no delivery mechanism of its own. Signed webhooks and notifications
 * already exist, with retries, backoff and a worker driving them; a third queue would be
 * a third set of failure modes and a third place for a message to get stuck. What is new
 * here is the routing: an action is chosen per journey and per outcome, so "on approval
 * call our activation endpoint, on rejection tell compliance and nobody else" is rows.
 *
 * See ADR-078.
 */

export type ActionOutcome = 'APPROVED' | 'REJECTED' | 'IN_REVIEW' | 'ANY';
export type ActionType = 'WEBHOOK' | 'NOTIFY';

export interface DefineActionInput {
  journeyCode: string;
  actionKey: string;
  onOutcome: ActionOutcome;
  type: ActionType;
  /** For a webhook. The endpoint must already be registered. */
  endpointId?: string;
  /** For a notification. The channel must already be proved. */
  channelId?: string;
  seq?: number;
}

export async function defineAction(
  tx: TenantTransaction,
  input: DefineActionInput,
): Promise<void> {
  if ((input.type === 'WEBHOOK') === (input.endpointId === undefined)) {
    throw new NxError('NX-4001', {
      detail: 'a webhook action names an endpoint and a notify action names a channel',
    });
  }

  await tx.query(
    `INSERT INTO case_actions (tenant_id, journey_code, action_key, seq, on_outcome,
                               action_type, endpoint_id, channel_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, journey_code, action_key) DO UPDATE SET
       seq = EXCLUDED.seq,
       on_outcome = EXCLUDED.on_outcome,
       action_type = EXCLUDED.action_type,
       endpoint_id = EXCLUDED.endpoint_id,
       channel_id = EXCLUDED.channel_id,
       status = 'active'`,
    [
      tx.tenantId,
      input.journeyCode,
      input.actionKey,
      input.seq ?? 1,
      input.onOutcome,
      input.type,
      input.endpointId ?? null,
      input.channelId ?? null,
    ],
  );
}

export interface DispatchedAction {
  actionKey: string;
  type: ActionType;
  /** The delivery this became, or null when its target was disabled meanwhile. */
  deliveryId: string | null;
}

const EVENT_FOR: Record<string, WebhookEventType> = {
  APPROVED: 'onboarding.approved',
  REJECTED: 'onboarding.rejected',
  IN_REVIEW: 'onboarding.review',
};

/**
 * Fires whatever this journey says to fire for this outcome.
 *
 * The payload is ours and carries the file rather than the applicant: a reference, a
 * journey, an outcome, our entity id and the customer's own reference. No identifier
 * (rule 4), no provider (rule 5), and no field values, because a webhook lands in a
 * system we do not control exactly as an email does.
 *
 * A file that fires nothing is recorded as firing nothing. "Why did their CRM never hear
 * about this" is a question with two possible answers, and only one of them is a bug.
 */
export async function dispatchCaseActions(
  tx: TenantTransaction,
  onboarding: OnboardingCase,
  options: { consoleUrl?: string } = {},
): Promise<DispatchedAction[]> {
  const status: CaseStatus = onboarding.status;
  if (status !== 'APPROVED' && status !== 'REJECTED' && status !== 'IN_REVIEW') {
    return [];
  }

  const { rows } = await tx.query<{
    action_key: string;
    action_type: ActionType;
    endpoint_id: string | null;
    channel_id: string | null;
  }>(
    `SELECT action_key, action_type, endpoint_id, channel_id
     FROM case_actions
     WHERE tenant_id = $1 AND journey_code = $2 AND status = 'active'
       AND on_outcome IN ($3, 'ANY')
     ORDER BY seq, action_key`,
    [tx.tenantId, onboarding.journeyCode, status],
  );

  const eventType = EVENT_FOR[status] ?? 'onboarding.review';
  const payload = {
    case_reference: onboarding.reference,
    journey: onboarding.journeyCode,
    status,
    outcome: onboarding.outcome,
    entity_id: onboarding.entityId,
    client_ref: onboarding.clientRef,
    decided_at: (onboarding.closedAt ?? new Date()).toISOString(),
  };

  const dispatched: DispatchedAction[] = [];

  for (const action of rows) {
    const deliveryId =
      action.action_type === 'WEBHOOK' && action.endpoint_id
        ? await queueEventTo(tx, {
            endpointId: action.endpoint_id,
            eventType,
            payload,
          })
        : action.channel_id
          ? await queueNotificationTo(tx, {
              channelId: action.channel_id,
              eventType,
              ...(options.consoleUrl === undefined ? {} : { consoleUrl: options.consoleUrl }),
            })
          : null;

    await tx.query(
      `INSERT INTO case_action_log (tenant_id, case_id, action_key, action_type, outcome,
                                    delivery_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tx.tenantId, onboarding.caseId, action.action_key, action.action_type, status, deliveryId],
    );

    dispatched.push({
      actionKey: action.action_key,
      type: action.action_type,
      deliveryId,
    });
  }

  return dispatched;
}

export interface ActionLogEntry {
  actionKey: string;
  actionType: ActionType;
  outcome: string;
  deliveryId: string | null;
  at: Date;
}

/** What this file fired, for the screen and for the question that follows an incident. */
export async function listCaseActions(
  tx: TenantTransaction,
  caseId: string,
): Promise<ActionLogEntry[]> {
  const { rows } = await tx.query<{
    action_key: string;
    action_type: ActionType;
    outcome: string;
    delivery_id: string | null;
    created_at: Date;
  }>(
    `SELECT action_key, action_type, outcome, delivery_id, created_at
     FROM case_action_log WHERE tenant_id = $1 AND case_id = $2 ORDER BY id`,
    [tx.tenantId, caseId],
  );

  return rows.map((row) => ({
    actionKey: row.action_key,
    actionType: row.action_type,
    outcome: row.outcome,
    deliveryId: row.delivery_id,
    at: row.created_at,
  }));
}
