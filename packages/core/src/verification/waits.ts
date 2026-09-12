import { createHash } from 'node:crypto';
import type { TenantTransaction } from '@nx-verify/db';
import { decryptJson, encryptJson } from '../crypto/payload.js';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import { NxError } from '../errors.js';

/**
 * Runs that are waiting for a provider to call back.
 *
 * A wait is the only thing standing between an asynchronous service and a run that hangs
 * for ever, so it carries two things: how to recognise the answer when it arrives, and
 * when to give up.
 *
 * Recognition is by digest. The provider's handle for the thing in flight is theirs, and
 * a column holding it would be one more place a support query reads something belonging
 * to a customer. Both sides hash it the same way and compare hashes.
 *
 * The subject is kept because resuming means running the product again and a product
 * needs its input. It is kept encrypted with the tenant's key, which is the only form
 * rule 4 permits.
 */

export function correlationDigest(
  provider: string,
  environment: string,
  correlation: string,
): string {
  return createHash('sha256').update(`${provider}:${environment}:${correlation}`).digest('hex');
}

export interface OpenWaitInput {
  keys: TenantKeyProvider;
  runId: string;
  provider: string;
  environment: 'sandbox' | 'live';
  subject: Readonly<Record<string, unknown>>;
  awaiting: { stepKey: string; correlation: string }[];
  /** How long the provider is given before the run is closed as unanswered. */
  ttlSeconds: number;
}

export async function openWaits(tx: TenantTransaction, input: OpenWaitInput): Promise<void> {
  const key = await input.keys.encryptionKey(tx.tenantId);
  const subject = encryptJson(key, input.subject);
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);

  for (const item of input.awaiting) {
    await tx.query(
      `INSERT INTO run_waits (tenant_id, run_id, step_key, provider, environment,
                              correlation_digest, subject_encrypted, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, run_id, step_key) DO UPDATE SET
         correlation_digest = EXCLUDED.correlation_digest,
         expires_at = EXCLUDED.expires_at,
         status = 'WAITING',
         resolved_at = NULL`,
      [
        tx.tenantId,
        input.runId,
        item.stepKey,
        input.provider,
        input.environment,
        correlationDigest(input.provider, input.environment, item.correlation),
        subject,
        expiresAt,
      ],
    );
  }
}

export interface MatchedWait {
  waitId: string;
  runId: string;
  stepKey: string;
  eventId: string;
}

/**
 * Pairs this tenant's open waits with deliveries that have arrived.
 *
 * The join is done here, in the tenant's own scope, rather than when the delivery landed.
 * A callback arrives before we know whose it is, so the table it lands in carries no
 * tenant and no policy could isolate one. Matching from inside the tenant keeps the
 * isolation intact: a wait can only ever see its own rows, and all it learns about a
 * delivery is that a digest it already holds was seen.
 */
export async function matchWaits(tx: TenantTransaction, limit = 100): Promise<MatchedWait[]> {
  const { rows } = await tx.query<{
    id: string;
    run_id: string;
    step_key: string;
    event_id: string;
  }>(
    `WITH paired AS (
       SELECT w.id, w.run_id, w.step_key, e.id AS event_id,
              row_number() OVER (PARTITION BY e.id ORDER BY w.created_at) AS rn
       FROM run_waits w
       JOIN inbound_events e
         ON e.correlation_digest = w.correlation_digest
        AND e.provider = w.provider
        AND e.environment = w.environment
        AND e.status = 'RECEIVED'
       WHERE w.tenant_id = $1 AND w.status = 'WAITING'
       LIMIT $2
     )
     SELECT id, run_id, step_key, event_id FROM paired WHERE rn = 1`,
    [tx.tenantId, limit],
  );

  for (const row of rows) {
    await tx.query(`UPDATE run_waits SET status = 'MATCHED', resolved_at = now() WHERE id = $1`, [
      row.id,
    ]);
    await tx.query(
      `UPDATE inbound_events SET status = 'MATCHED', processed_at = now() WHERE id = $1`,
      [row.event_id],
    );
  }

  return rows.map((row) => ({
    waitId: row.id,
    runId: row.run_id,
    stepKey: row.step_key,
    eventId: row.event_id,
  }));
}

export interface StoredWait {
  waitId: string;
  runId: string;
  stepKey: string;
  provider: string;
  environment: 'sandbox' | 'live';
  subject: Readonly<Record<string, unknown>>;
}

export async function loadWait(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  waitId: string,
): Promise<StoredWait> {
  const { rows } = await tx.query<{
    id: string;
    run_id: string;
    step_key: string;
    provider: string;
    environment: 'sandbox' | 'live';
    subject_encrypted: Buffer;
  }>(
    `SELECT id, run_id, step_key, provider, environment, subject_encrypted
     FROM run_waits WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, waitId],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', { detail: 'no such wait' });
  }

  const key = await keys.encryptionKey(tx.tenantId);
  return {
    waitId: row.id,
    runId: row.run_id,
    stepKey: row.step_key,
    provider: row.provider,
    environment: row.environment,
    subject: decryptJson<Record<string, unknown>>(key, row.subject_encrypted),
  };
}

export async function markResumed(tx: TenantTransaction, waitId: string): Promise<void> {
  await tx.query(`UPDATE run_waits SET status = 'RESUMED', resolved_at = now() WHERE id = $1`, [
    waitId,
  ]);
}

/**
 * Gives up on waits the provider never answered.
 *
 * A run that waits for ever is worse than one that failed: the customer is told nothing
 * and keeps a case open against an answer that is not coming. Expiry closes it as an
 * error, which is never billed.
 */
export async function expireWaits(tx: TenantTransaction): Promise<string[]> {
  const { rows } = await tx.query<{ run_id: string }>(
    `UPDATE run_waits
     SET status = 'EXPIRED', resolved_at = now()
     WHERE tenant_id = $1 AND status = 'WAITING' AND expires_at <= now()
     RETURNING run_id`,
    [tx.tenantId],
  );
  return rows.map((row) => row.run_id);
}

export interface OpenWait {
  runId: string;
  stepKey: string;
  expiresAt: Date;
}

export async function listOpenWaits(tx: TenantTransaction): Promise<OpenWait[]> {
  const { rows } = await tx.query<{ run_id: string; step_key: string; expires_at: Date }>(
    `SELECT run_id, step_key, expires_at FROM run_waits
     WHERE tenant_id = $1 AND status = 'WAITING'
     ORDER BY expires_at`,
    [tx.tenantId],
  );
  return rows.map((row) => ({
    runId: row.run_id,
    stepKey: row.step_key,
    expiresAt: row.expires_at,
  }));
}
