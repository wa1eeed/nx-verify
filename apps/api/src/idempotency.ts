import {
  NxError,
  claimIdempotentRequest,
  idempotentRequestFingerprint,
  recordIdempotentResponse,
  releaseIdempotentRequest,
} from '@nx-verify/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from './context.js';

/**
 * Rule 7 at the layer the rule is written about (ADR-183).
 *
 * «كل POST يقبل `Idempotency-Key` ويحترمه» was true of one endpoint. `verification_runs`
 * carries the key in a unique index, so a repeated verification is replayed by the run record
 * itself, and every other POST read the header nowhere: opening an onboarding file, advancing
 * it, creating a batch, confirming it, starting a monitor, adding a customer to a portfolio.
 * Six of those spend the subscriber's money. A network timeout on the customer's side, the
 * retry every sane HTTP client then makes, and the platform opened a second file and charged
 * for it a second time.
 *
 * It is two pieces rather than a change in each handler, and that is the point: a rule enforced
 * by remembering to call something is a rule that lasts until the next endpoint. A POST added
 * tomorrow is covered because it authenticates, not because its author read this file.
 *
 *   claimIdempotency  runs at the end of `requireAuth`, the one function every authenticated
 *                     route already uses. A duplicate loses at the primary key, so the loser
 *                     never reaches the handler and the action cannot run twice; a finished
 *                     request is replayed there and the handler is never entered at all.
 *   the onSend hook   records the answer byte for byte when it succeeded, and lets the key go
 *                     when it did not, so a caller who fixes their payload may reuse it.
 *
 * The claim lives inside `requireAuth` rather than in an instance hook of its own because of
 * two orderings that cannot both be satisfied by a hook. It is keyed by workspace, so it must
 * run after authentication; but Fastify applies an instance level `preHandler` before every
 * route level one, and applies none at all to routes registered before the hook was added. The
 * recorder has no such constraint and is a plain `onSend`, registered with the other ones.
 *
 * What is not covered, deliberately: a request with no key runs exactly as it always did. The
 * rule says accepts and honours, not requires, and a mandatory header would break every
 * integration that exists today.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** Set only when this request claimed a key and must record its answer. */
    idempotentClaim?: { route: string; key: string; fingerprint: string; tenantId: string };
  }
}

/** The header, when the caller sent exactly one usable value. */
function keyOf(request: FastifyRequest): string | null {
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > 255) {
    // The column stops at 255. Refusing here says which header is wrong, where truncating
    // would silently make two different keys the same key.
    throw new NxError('NX-4001', {
      detail: 'Idempotency-Key is longer than 255 characters',
      requestId: request.id,
    });
  }
  return trimmed;
}

/**
 * The route pattern, never the resolved path.
 *
 * `/v1/batches/:id/confirm`, not the batch id, because a path carries values and rule 4 keeps
 * values out of anything stored. The id is not lost by this: it travels inside the fingerprint
 * through `request.params`, so the same key aimed at a different batch is refused as the
 * different request it is.
 */
function routeOf(request: FastifyRequest): string | null {
  const url = request.routeOptions?.url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

/**
 * Which POSTs this covers: all of them, except the ones that carry nothing forward.
 *
 * `/v1/verifications` honours the header through the run record, which is a stronger claim
 * than this one: it is held by the row the provider call is recorded on, inside the same
 * transaction, so there is no window at all between claiming and doing. Wrapping it again
 * would add a second key holder that can disagree with the first.
 *
 * `/v1/batches/preview` and the callback endpoint change nothing a repeat could duplicate.
 */
const NOT_COVERED = new Set(['/v1/verifications', '/v1/batches/preview']);

/**
 * Claims this request's key, or answers it from the record.
 *
 * Returns true when the reply has already been sent, which is a replay: the caller must stop
 * the chain so the handler is never entered.
 */
export async function claimIdempotency(
  context: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (request.method !== 'POST') {
    return false;
  }
  const route = routeOf(request);
  const caller = request.caller;
  if (route === null || caller === undefined || NOT_COVERED.has(route)) {
    return false;
  }
  const key = keyOf(request);
  if (key === null) {
    return false;
  }

  const keyVersion = await context.keys.currentVersion();
  const fingerprintFor = async (version: number): Promise<string> =>
    idempotentRequestFingerprint(await context.keys.hmacKey(caller.tenantId, version), {
      method: request.method,
      route,
      params: (request.params ?? {}) as Record<string, unknown>,
      body: request.body ?? null,
    });

  // Its own transaction, which commits before the handler is entered. That commit is what
  // makes two simultaneous retries safe: the second one meets a row that already exists.
  const claim = await context.withTenant(caller.tenantId, (tx) =>
    claimIdempotentRequest(tx, { route, key, keyVersion, fingerprintFor }),
  );

  if (claim.kind === 'mismatch') {
    throw new NxError('NX-4092', {
      // The key itself is the caller's, and naming it back in an error body puts it in a log
      // that keeps error bodies. The route is what they need to look at.
      detail: `a different request already claimed this key on ${route}`,
      requestId: request.id,
    });
  }
  if (claim.kind === 'in_flight') {
    throw new NxError('NX-4093', { requestId: request.id });
  }
  if (claim.kind === 'replay') {
    // Named, because a caller debugging a retry loop needs to know the platform answered
    // from its record rather than doing the work again.
    void reply.header('idempotency-replayed', 'true');
    void reply.type(claim.response.contentType);
    await reply.status(claim.response.status).send(claim.response.body);
    return true;
  }

  request.idempotentClaim = {
    route,
    key,
    fingerprint: claim.fingerprint,
    tenantId: caller.tenantId,
  };
  return false;
}

/** The other half: the answer is written onto the claim as it leaves. */
export function registerIdempotencyRecorder(app: FastifyInstance, context: AppContext): void {
  app.addHook('onSend', async (request, reply, payload) => {
    const held = request.idempotentClaim;
    if (held === undefined) {
      return payload;
    }
    // Once, whatever else happens to this reply.
    request.idempotentClaim = undefined as unknown as typeof held;

    const status = reply.statusCode;
    if (status >= 400) {
      /**
       * Nothing to replay, so the key goes back.
       *
       * A refusal is not an outcome worth remembering: the caller fixes their payload and
       * retries, and holding the key would refuse them for a request the platform never
       * carried out. Releasing it is also safe by construction, because a 4xx means the
       * handler did not get far enough to charge anything.
       */
      await context
        .withTenant(held.tenantId, (tx) => releaseIdempotentRequest(tx, held))
        .catch((error: unknown) => {
          request.log.error({ err: error }, 'could not release an idempotency claim');
        });
      return payload;
    }

    const body = typeof payload === 'string' ? payload : null;
    if (body === null) {
      /**
       * A stream or a buffer, which is a sealed document rather than an envelope.
       *
       * The claim is released rather than completed: recording a body we did not read would
       * mean replaying something we cannot promise is the same bytes, and a key that is held
       * with nothing behind it would refuse the caller's next honest retry for ever.
       */
      await context
        .withTenant(held.tenantId, (tx) => releaseIdempotentRequest(tx, held))
        .catch(() => undefined);
      return payload;
    }

    const recorded = await context
      .withTenant(held.tenantId, (tx) =>
        recordIdempotentResponse(tx, {
          route: held.route,
          key: held.key,
          fingerprint: held.fingerprint,
          response: {
            status,
            body,
            contentType: String(reply.getHeader('content-type') ?? 'application/json'),
          },
        }),
      )
      .catch((error: unknown) => {
        // The work succeeded and the caller must be told so. A failure to write the note
        // about it costs a replay, not the answer.
        request.log.error({ err: error }, 'could not record an idempotent response');
        return false;
      });

    if (!recorded) {
      request.log.warn({ route: held.route }, 'the idempotency claim was no longer ours');
    }
    return payload;
  });
}

