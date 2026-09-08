import {
  claimPendingDeliveries,
  recordDeliveryResult,
  signPayload,
  SIGNATURE_HEADER,
} from '@nx-verify/core';
import type { TenantTransaction } from '@nx-verify/db';
import type { SecretStore } from '@nx-verify/providers';

/**
 * Webhook delivery.
 *
 * Signing covers the timestamp as well as the body, so a captured delivery cannot be
 * replayed against the customer forever. The secret is fetched from the KMS per delivery
 * and never stored here (rule 10).
 *
 * Failures back off and then give up. An endpoint that has been down for a day is not
 * going to be fixed by attempt two hundred, and the deliveries remain readable in the
 * console either way.
 */

export type DeliverFn = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<{ ok: boolean; status: number }>;

export interface DeliverWebhooksOptions {
  secrets: SecretStore;
  deliver: DeliverFn;
  limit?: number;
  now?: () => number;
}

export interface DeliverySummary {
  deliveryId: string;
  ok: boolean;
  status: number;
}

export async function deliverWebhooks(
  tx: TenantTransaction,
  options: DeliverWebhooksOptions,
): Promise<DeliverySummary[]> {
  const pending = await claimPendingDeliveries(tx, options.limit ?? 50);
  const summaries: DeliverySummary[] = [];

  for (const delivery of pending) {
    const body = JSON.stringify({
      id: delivery.id,
      type: delivery.eventType,
      created_at: new Date().toISOString(),
      data: delivery.payload,
    });

    const timestamp = Math.floor((options.now?.() ?? Date.now()) / 1000);
    const material = await options.secrets.fetch(delivery.secretRef);
    const secret = material['signingSecret'] ?? material['apiKey'] ?? '';

    let outcome: { ok: boolean; status: number };
    try {
      outcome = await options.deliver(delivery.url, body, {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signPayload(secret, body, timestamp),
      });
    } catch {
      outcome = { ok: false, status: 0 };
    }

    await recordDeliveryResult(tx, delivery.id, {
      ok: outcome.ok,
      statusCode: outcome.status,
    });
    summaries.push({ deliveryId: delivery.id, ok: outcome.ok, status: outcome.status });
  }

  return summaries;
}
