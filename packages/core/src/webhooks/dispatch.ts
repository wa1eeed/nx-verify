import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { nextRetryAt } from './signing.js';
import { queueNotifications } from '../notifications/notifications.js';

/**
 * Queueing webhook deliveries.
 *
 * A delivery is written inside the same transaction as the change that caused it, so an
 * event cannot be announced for something that was rolled back, and a committed change
 * cannot silently fail to notify. Sending happens later, from the worker.
 */

export type WebhookEventType =
  | 'verification.completed'
  // The provider took the request and answers on its own schedule. Said out loud rather
  // than left to be discovered by polling: a run that goes quiet and then completes looks
  // like a fault while it is quiet.
  | 'verification.awaiting'
  | 'entity.changed'
  | 'attestation.expired'
  | 'wallet.low'
  | 'monitor.budget_exhausted'
  | 'onboarding.approved'
  | 'onboarding.rejected'
  | 'onboarding.review';

/*
 * The Arabic names of these events live in apps/console/src/components/events.ts, not here.
 * The forms that show them run in the browser, and a client component importing this module
 * drags the whole server side in behind it, `pg` included. What stays here is the union, and
 * a test holds the console's map against it.
 */

export interface WebhookEndpoint {
  id: string;
  url: string;
  secretRef: string;
  events: string[];
  status: string;
}

export async function listEndpoints(
  tx: TenantTransaction,
  eventType?: string,
): Promise<WebhookEndpoint[]> {
  const { rows } = await tx.query<{
    id: string;
    url: string;
    secret_ref: string;
    events: string[];
    status: string;
  }>(
    `SELECT id, url, secret_ref, events, status
     FROM webhook_endpoints
     WHERE tenant_id = $1 AND status = 'active'
       AND ($2::text IS NULL OR $2 = ANY (events))
     ORDER BY created_at`,
    [tx.tenantId, eventType ?? null],
  );

  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    secretRef: row.secret_ref,
    events: row.events,
    status: row.status,
  }));
}

export interface QueueEventInput {
  eventType: WebhookEventType;
  payload: Record<string, unknown>;
}

/**
 * Announces an event on every channel the subscriber has.
 *
 * Both fan outs happen here rather than at the call site, so an event added later reaches
 * the customer's systems and the customer's people without whoever adds it remembering
 * that there are two kinds of recipient. The payload goes to the endpoints, which are the
 * customer's own machines; the people get a message that carries none of it.
 */
export async function queueEvent(tx: TenantTransaction, input: QueueEventInput): Promise<string[]> {
  await queueNotifications(tx, { eventType: input.eventType });

  const endpoints = await listEndpoints(tx, input.eventType);
  const ids: string[] = [];

  for (const endpoint of endpoints) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO webhook_deliveries (tenant_id, endpoint_id, event_type, payload, next_retry_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       RETURNING id`,
      [tx.tenantId, endpoint.id, input.eventType, JSON.stringify(input.payload)],
    );
    const id = rows[0]?.id;
    if (id) {
      ids.push(id);
    }
  }

  return ids;
}

export interface PendingDelivery {
  id: string;
  endpointId: string;
  url: string;
  secretRef: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export async function claimPendingDeliveries(
  tx: TenantTransaction,
  limit = 50,
): Promise<PendingDelivery[]> {
  const { rows } = await tx.query<{
    id: string;
    endpoint_id: string;
    url: string;
    secret_ref: string;
    event_type: string;
    payload: Record<string, unknown>;
    attempts: number;
  }>(
    `SELECT d.id, d.endpoint_id, e.url, e.secret_ref, d.event_type, d.payload, d.attempts
     FROM webhook_deliveries d
     JOIN webhook_endpoints e ON e.tenant_id = d.tenant_id AND e.id = d.endpoint_id
     WHERE d.tenant_id = $1 AND d.status = 'pending' AND d.next_retry_at <= now()
     ORDER BY d.next_retry_at
     LIMIT $2
     FOR UPDATE OF d SKIP LOCKED`,
    [tx.tenantId, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    endpointId: row.endpoint_id,
    url: row.url,
    secretRef: row.secret_ref,
    eventType: row.event_type,
    payload: row.payload,
    attempts: row.attempts,
  }));
}

export async function recordDeliveryResult(
  tx: TenantTransaction,
  deliveryId: string,
  result: { ok: boolean; statusCode?: number | undefined },
): Promise<void> {
  if (result.ok) {
    await tx.query(
      `UPDATE webhook_deliveries
       SET status = 'delivered', delivered_at = now(), attempts = attempts + 1,
           last_status = $3, next_retry_at = NULL
       WHERE tenant_id = $1 AND id = $2`,
      [tx.tenantId, deliveryId, result.statusCode ?? null],
    );
    return;
  }

  const { rows } = await tx.query<{ attempts: number }>(
    `SELECT attempts FROM webhook_deliveries WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, deliveryId],
  );
  const attempts = (rows[0]?.attempts ?? 0) + 1;
  const retryAt = nextRetryAt(attempts);

  await tx.query(
    `UPDATE webhook_deliveries
     SET attempts = $3, last_status = $4, next_retry_at = $5,
         status = CASE WHEN $5::timestamptz IS NULL THEN 'abandoned' ELSE 'pending' END
     WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, deliveryId, attempts, result.statusCode ?? null, retryAt],
  );
}

export async function registerEndpoint(
  tx: TenantTransaction,
  input: { url: string; secretRef: string; events: string[] },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO webhook_endpoints (tenant_id, url, secret_ref, events)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [tx.tenantId, input.url, input.secretRef, input.events],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new NxError('NX-5001', { detail: 'webhook endpoint insert returned no id' });
  }
  return id;
}

/**
 * Pauses an endpoint, or starts it again (ADR-147).
 *
 * Pausing, not deleting: the deliveries already queued to it carry its id, and what was sent
 * is a fact. A paused endpoint receives nothing, because both the queue and the dispatcher
 * read only active rows.
 *
 * The signing secret is left where it is. An endpoint that is paused for a fortnight and
 * started again must verify the same signatures afterwards, and a subscriber who has to
 * change the secret in their own system to switch us back on will simply not switch us back
 * on.
 */
export async function setEndpointStatus(
  tx: TenantTransaction,
  endpointId: string,
  status: 'active' | 'paused',
): Promise<void> {
  await tx.query(`UPDATE webhook_endpoints SET status = $3 WHERE tenant_id = $1 AND id = $2`, [
    tx.tenantId,
    endpointId,
    status,
  ]);
}

/** Every endpoint, paused ones included, for the screen that manages them. */
export async function listAllEndpoints(tx: TenantTransaction): Promise<WebhookEndpoint[]> {
  const { rows } = await tx.query<{
    id: string;
    url: string;
    secret_ref: string;
    events: string[];
    status: string;
  }>(
    `SELECT id, url, secret_ref, events, status
     FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at`,
    [tx.tenantId],
  );
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    secretRef: row.secret_ref,
    events: row.events,
    status: row.status,
  }));
}

/**
 * Queues one delivery to one endpoint.
 *
 * Endpoints subscribe to event types globally, which is right for events: a customer who
 * wants every completed verification says so once. An onboarding action is the other
 * shape, chosen per journey and per outcome, so it names its endpoint and this queues to
 * that one alone. The delivery, the signature, the retries and the worker are the same.
 */
export async function queueEventTo(
  tx: TenantTransaction,
  input: { endpointId: string; eventType: string; payload: Record<string, unknown> },
): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO webhook_deliveries (tenant_id, endpoint_id, event_type, payload, next_retry_at)
     SELECT $1, e.id, $3, $4::jsonb, now()
     FROM webhook_endpoints e
     WHERE e.tenant_id = $1 AND e.id = $2 AND e.status = 'active'
     RETURNING id`,
    [tx.tenantId, input.endpointId, input.eventType, JSON.stringify(input.payload)],
  );
  return rows[0]?.id ?? null;
}
