import { queueEvent } from '@nx-verify/core';
import type { TenantTransaction } from '@nx-verify/db';

/**
 * Saying that a fact has gone out of date.
 *
 * Freshness is arithmetic: nothing writes it, and a field passes its time to live by the clock
 * alone. So nothing was announcing it either. `attestation.expired` existed as an event type
 * with a message written for it, a subscriber could subscribe to it on the notifications
 * screen, and they would never have heard from it. A subscription that can never fire is worse
 * than no subscription at all.
 *
 * What is announced is the crossing, not the state. A field that expired in the window since
 * the last sweep is announced once; a field that expired months ago is not announced again,
 * because a compliance team told every day about the same expiry stops reading the mail. That
 * is also why this needs no table to remember what it has said: the window is the memory.
 *
 * The cost of that choice, stated plainly: a worker that is down for a whole day misses that
 * day's crossings. They are still on the alerts screen, which reads the state rather than the
 * crossing, so nothing is lost, only the message.
 */

export interface ExpiryAlertOptions {
  /** How far back to look. Should match the interval this job runs at. */
  sinceHours?: number;
  /** At most this many announcements per sweep, so one bad day cannot flood a mailbox. */
  limit?: number;
}

export interface ExpirySummary {
  announced: number;
}

export async function announceExpiries(
  tx: TenantTransaction,
  options: ExpiryAlertOptions = {},
): Promise<ExpirySummary> {
  const sinceHours = options.sinceHours ?? 24;
  const limit = options.limit ?? 200;

  const { rows } = await tx.query<{
    entity_id: string;
    field_path: string;
    effective_until: Date;
    attestation_id: string;
  }>(
    `SELECT entity_id, field_path, effective_until, attestation_id
     FROM entity_profile
     WHERE tenant_id = $1
       AND freshness = 'expired'
       AND effective_until IS NOT NULL
       AND effective_until > now() - make_interval(hours => $2)
       AND effective_until <= now()
     ORDER BY effective_until
     LIMIT $3`,
    [tx.tenantId, sinceHours, limit],
  );

  for (const row of rows) {
    // The event says which field of which entity, and nothing about its value: a webhook
    // lands in a system we do not control, and a message says that something happened and
    // never what.
    await queueEvent(tx, {
      eventType: 'attestation.expired',
      payload: {
        entity_id: row.entity_id,
        field_path: row.field_path,
        expired_at: row.effective_until.toISOString(),
        attestation_id: row.attestation_id,
      },
    });
  }

  return { announced: rows.length };
}
