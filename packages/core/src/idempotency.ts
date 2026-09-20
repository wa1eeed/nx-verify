import { createHmac } from 'node:crypto';
import type { TenantTransaction } from '@nx-verify/db';
import { canonicalJson } from './canonical-json.js';
import { NxError } from './errors.js';

/**
 * Rule 7 for every POST, not for one of them (ADR-183).
 *
 * `verification_runs` has carried an idempotency key since unit 9, and it works: the key is
 * claimed by inserting a PENDING run before a provider is called, so a duplicate loses at a
 * unique index and never reaches anybody. What it cannot do is cover a POST that is not a
 * verification run. Opening an onboarding file, advancing it, creating a batch, confirming
 * it, starting a monitor: six endpoints that spend the subscriber's money and honoured the
 * header nowhere.
 *
 * So the same claim first shape lives here, one level up, keyed by the request rather than
 * by the run:
 *
 *   1. Claim (workspace, route, key) by inserting an IN_FLIGHT row. A duplicate loses at the
 *      primary key, which is what makes two simultaneous retries safe: the loser never
 *      reaches the handler, so the action cannot run twice.
 *   2. Record the answer on that row when the request succeeds, byte for byte.
 *   3. Replay that answer, with its status, for every later request under the same key.
 *
 * Three refusals rather than a guess:
 *
 *   - The same key with a different request is refused (NX-4092). Answering the old request
 *     silently would be the platform deciding, on the customer's behalf, that the call they
 *     just made did not happen. That is a bug in their integration and they have to see it.
 *   - A request still running under the key is refused (NX-4093) rather than waited for. A
 *     wait holds a socket for as long as a provider takes, and a queue of waiters behind a
 *     request that then dies is a queue that hangs; a refusal that says «retry» costs the
 *     caller one round trip and can never double charge.
 *   - A claim older than the lease is taken over, because the process that held it is gone
 *     and a key nobody can ever use again is a key that bricked the client's retry loop.
 *
 * A request with no key runs exactly as it always did. Rule 7 says accepts and honours, not
 * requires, and making the header mandatory would break every integration that exists.
 */

/** How long a recorded answer is replayed for, and after which the key is free again. */
export const IDEMPOTENCY_REPLAY_WINDOW = '24 hours';

/**
 * How long a claim is honoured before it is treated as abandoned.
 *
 * Long enough that no live request is ever mistaken for a dead one: the slowest thing behind
 * these endpoints is a batch of provider calls, measured in seconds. Short enough that a
 * process killed mid request does not hold the customer's key until tomorrow.
 */
export const IDEMPOTENCY_LEASE = '10 minutes';

/**
 * The two refusals this layer adds live in the one catalogue, `errors.ts`, beside every other
 * code the API can return. They were briefly defined here instead, and that was wrong twice
 * over: `errorCatalogue()` feeds the API reference screen (ADR-169), so a code outside it is a
 * code the caller reading our own documentation cannot look up, and a second catalogue is the
 * same content in two places with a standing chance of disagreeing.
 */

export interface IdempotentRequestParts {
  method: string;
  /** The route pattern. The values in the path travel in `params`. */
  route: string;
  params?: Record<string, unknown> | undefined;
  body?: unknown;
}

/**
 * What makes two requests the same request.
 *
 * Keyed with the workspace's hmac key rather than a bare digest, because the body carries the
 * subject and the subject carries a national id (rule 4). A plain SHA-256 over
 * `{"product":"ADDRESS_ONLY","subject":{"unn":"..."}}` is a ten digit search away from the
 * value it was taken over; an HMAC is not.
 *
 * The path parameters are inside it, so the same key aimed at a different batch is the
 * different request it is and is refused as one.
 */
export function idempotentRequestFingerprint(hmacKey: Buffer, parts: IdempotentRequestParts): string {
  return createHmac('sha256', hmacKey)
    .update(
      canonicalJson({
        method: parts.method.toUpperCase(),
        route: parts.route,
        params: parts.params ?? {},
        body: parts.body ?? null,
      }),
    )
    .digest('hex');
}

export interface RecordedResponse {
  status: number;
  body: string;
  contentType: string;
}

export type IdempotentClaim =
  /** The key is ours. Run the handler, then record the answer under this fingerprint. */
  | { kind: 'claimed'; fingerprint: string }
  /** The same request finished already. This is its answer, unchanged. */
  | { kind: 'replay'; fingerprint: string; response: RecordedResponse }
  /** The same request is running right now, somewhere. */
  | { kind: 'in_flight' }
  /** The key is bound to a different request. */
  | { kind: 'mismatch' };

export interface IdempotentClaimInput {
  /** The route pattern, never the resolved path: a path carries values (rule 4). */
  route: string;
  key: string;
  /** The key version a new fingerprint is taken with. */
  keyVersion: number;
  /**
   * This request's fingerprint under a given key version.
   *
   * A function rather than a string because the master key rotates (ADR-045), and a row
   * written before a rotation carries a fingerprint from the older version. Recomputing at
   * the stored version is what keeps a rotation from turning an honest retry into NX-4092.
   */
  fingerprintFor: (keyVersion: number) => Promise<string>;
  replayWindow?: string;
  lease?: string;
}

export async function claimIdempotentRequest(
  tx: TenantTransaction,
  input: IdempotentClaimInput,
): Promise<IdempotentClaim> {
  const fingerprint = await input.fingerprintFor(input.keyVersion);
  const replayWindow = input.replayWindow ?? IDEMPOTENCY_REPLAY_WINDOW;
  const lease = input.lease ?? IDEMPOTENCY_LEASE;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const claimed = await tx.query(
      `INSERT INTO idempotent_requests
         (tenant_id, route, idempotency_key, request_fingerprint, key_version,
          status, claimed_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'IN_FLIGHT', now(), now() + $6::interval)
       ON CONFLICT (tenant_id, route, idempotency_key) DO UPDATE
         SET request_fingerprint = EXCLUDED.request_fingerprint,
             key_version = EXCLUDED.key_version,
             status = 'IN_FLIGHT',
             claimed_at = now(),
             expires_at = EXCLUDED.expires_at,
             response_status = NULL,
             response_body = NULL,
             response_content_type = NULL,
             completed_at = NULL
         WHERE idempotent_requests.expires_at <= now()
            OR (idempotent_requests.status = 'IN_FLIGHT'
                AND idempotent_requests.claimed_at <= now() - $7::interval
                AND idempotent_requests.request_fingerprint = EXCLUDED.request_fingerprint
                AND idempotent_requests.key_version = EXCLUDED.key_version)
       RETURNING 1 AS claimed`,
      [tx.tenantId, input.route, input.key, fingerprint, input.keyVersion, replayWindow, lease],
    );

    if ((claimed.rowCount ?? 0) > 0) {
      return { kind: 'claimed', fingerprint };
    }

    const { rows } = await tx.query<{
      request_fingerprint: string;
      key_version: number;
      status: string;
      response_status: number | null;
      response_body: string | null;
      response_content_type: string | null;
    }>(
      `SELECT request_fingerprint, key_version, status,
              response_status, response_body, response_content_type
         FROM idempotent_requests
        WHERE tenant_id = $1 AND route = $2 AND idempotency_key = $3`,
      [tx.tenantId, input.route, input.key],
    );

    const held = rows[0];
    if (!held) {
      // The row was released between the insert and this read. Claim it again rather than
      // refusing a request that nothing is actually holding.
      continue;
    }

    const expected =
      held.key_version === input.keyVersion
        ? fingerprint
        : await input.fingerprintFor(held.key_version);
    if (expected !== held.request_fingerprint) {
      return { kind: 'mismatch' };
    }

    if (held.status !== 'COMPLETED') {
      return { kind: 'in_flight' };
    }

    if (
      held.response_status === null ||
      held.response_body === null ||
      held.response_content_type === null
    ) {
      // The table forbids this shape. Reaching it means the row was written by something
      // other than this module, and replaying half an answer is worse than saying so.
      throw new NxError('NX-5001', { detail: 'a recorded response carries no answer' });
    }

    return {
      kind: 'replay',
      fingerprint,
      response: {
        status: held.response_status,
        body: held.response_body,
        contentType: held.response_content_type,
      },
    };
  }

  throw new NxError('NX-5001', { detail: 'the idempotency key could not be claimed' });
}

export interface RecordIdempotentResponseInput {
  route: string;
  key: string;
  /** The fingerprint this claim was made under, so a taken over claim is never overwritten. */
  fingerprint: string;
  response: RecordedResponse;
}

/** Returns false when the claim is no longer ours, which is not an error the caller can fix. */
export async function recordIdempotentResponse(
  tx: TenantTransaction,
  input: RecordIdempotentResponseInput,
): Promise<boolean> {
  const result = await tx.query(
    `UPDATE idempotent_requests
        SET status = 'COMPLETED',
            response_status = $4,
            response_body = $5,
            response_content_type = $6,
            completed_at = now()
      WHERE tenant_id = $1 AND route = $2 AND idempotency_key = $3
        AND status = 'IN_FLIGHT' AND request_fingerprint = $7`,
    [
      tx.tenantId,
      input.route,
      input.key,
      input.response.status,
      input.response.body,
      input.response.contentType,
      input.fingerprint,
    ],
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Lets a claimed key go.
 *
 * Used when the request did not succeed. Nothing happened, so nothing is worth replaying, and
 * holding the key would mean a caller who fixes their payload and retries with the same key
 * is refused for a request the platform never carried out.
 */
export async function releaseIdempotentRequest(
  tx: TenantTransaction,
  input: { route: string; key: string; fingerprint: string },
): Promise<void> {
  await tx.query(
    `DELETE FROM idempotent_requests
      WHERE tenant_id = $1 AND route = $2 AND idempotency_key = $3
        AND status = 'IN_FLIGHT' AND request_fingerprint = $4`,
    [tx.tenantId, input.route, input.key, input.fingerprint],
  );
}
