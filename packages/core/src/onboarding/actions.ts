import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { listEndpoints, queueEventTo, type WebhookEventType } from '../webhooks/dispatch.js';
import { queueNotifications, queueNotificationTo } from '../notifications/notifications.js';
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
 * Those rows narrow a route. They are not the route (ADR-182). A subscriber already says
 * where events go, once, on two screens they have: an endpoint subscribes to
 * `onboarding.approved` and a proved address subscribes to the same event. Until this
 * module read those subscriptions, ticking either box delivered nothing: the only producer
 * of an onboarding event was a `case_actions` row, and no surface writes one. So the
 * default route is the subscription, and a journey with actions of its own uses them
 * instead, which is what "and nobody else" asks for.
 *
 * See ADR-078, ADR-079 and ADR-182.
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

export async function defineAction(tx: TenantTransaction, input: DefineActionInput): Promise<void> {
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
 * What a firing carries when it went where a subscription said to send it rather than to
 * an action named for this journey. The console turns it into words; nothing branches on
 * it but that.
 */
export const SUBSCRIPTION_ACTION_KEY = 'subscription';

/** One firing, written down before it is returned. Every firing is written down (ADR-079). */
async function recordFiring(
  tx: TenantTransaction,
  onboarding: OnboardingCase,
  outcome: CaseStatus,
  action: DispatchedAction,
): Promise<DispatchedAction> {
  await tx.query(
    `INSERT INTO case_action_log (tenant_id, case_id, action_key, action_type, outcome,
                                  delivery_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tx.tenantId, onboarding.caseId, action.actionKey, action.type, outcome, action.deliveryId],
  );
  return action;
}

/**
 * Fires whatever this decision goes to.
 *
 * Two routes, and the narrower one wins. A journey with actions of its own is routed by
 * them, and an outcome those actions do not name fires nothing, because "on rejection tell
 * compliance and nobody else" has to be able to mean nobody else. A journey with no
 * actions falls back to the subscriptions the customer already set up: the endpoints that
 * asked for this event type and the proved addresses that asked for it (ADR-182).
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

  // Every active action of this journey, not only the ones this outcome fires: a journey
  // that routes itself does so for all of its outcomes, and the difference between "this
  // outcome goes nowhere" and "this journey says nothing" is the difference between the
  // two routes below.
  const { rows } = await tx.query<{
    action_key: string;
    action_type: ActionType;
    endpoint_id: string | null;
    channel_id: string | null;
    fires: boolean;
  }>(
    `SELECT action_key, action_type, endpoint_id, channel_id,
            on_outcome IN ($3, 'ANY') AS fires
     FROM case_actions
     WHERE tenant_id = $1 AND journey_code = $2 AND status = 'active'
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

  if (rows.length > 0) {
    for (const action of rows.filter((row) => row.fires)) {
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

      dispatched.push(
        await recordFiring(tx, onboarding, status, {
          actionKey: action.action_key,
          type: action.action_type,
          deliveryId,
        }),
      );
    }

    return dispatched;
  }

  // Nobody narrowed this journey, so the decision goes where this customer already said
  // this kind of event goes. Both fan outs, because a decision reaches a system and a
  // person by two different paths and the subscriber set each one up separately.
  for (const endpoint of await listEndpoints(tx, eventType)) {
    const deliveryId = await queueEventTo(tx, { endpointId: endpoint.id, eventType, payload });
    dispatched.push(
      await recordFiring(tx, onboarding, status, {
        actionKey: SUBSCRIPTION_ACTION_KEY,
        type: 'WEBHOOK',
        deliveryId,
      }),
    );
  }

  const messages = await queueNotifications(tx, {
    eventType,
    ...(options.consoleUrl === undefined ? {} : { consoleUrl: options.consoleUrl }),
  });
  for (const messageId of messages) {
    dispatched.push(
      await recordFiring(tx, onboarding, status, {
        actionKey: SUBSCRIPTION_ACTION_KEY,
        type: 'NOTIFY',
        deliveryId: messageId,
      }),
    );
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
