import {
  NxError,
  recordInboundEvent,
  resolveCallback,
  verifyProviderSignature,
} from '@nx-verify/core';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

/**
 * Where a provider's own call lands.
 *
 * This is the one route with no API key. The caller is a provider, not a subscriber, and
 * it authenticates the only way a third party can: by signing the body with a secret we
 * both hold. So the signature is not a nicety here, it is the whole of the authentication,
 * and an unsigned body is refused before it is looked at.
 *
 * The path carries an opaque slug rather than a provider name. Rule 5 applies to every
 * public surface, and a URL that says which provider we use is that name published,
 * whoever happens to be calling it.
 */
export function registerCallbackRoutes(app: FastifyInstance, context: AppContext): void {
  // Registered in its own scope so the parser below applies to this route and nothing
  // else. Every other route wants parsed JSON; this one needs the exact bytes, because a
  // signature over a re-serialised object is a signature over a different document.
  app.register(async (scope) => {
    scope.addContentTypeParser(
      ['application/json', 'application/json; charset=utf-8'],
      { parseAs: 'buffer' },
      (_request, body, done) => {
        done(null, body);
      },
    );

    scope.post<{ Params: { slug: string } }>('/v1/callbacks/:slug', async (request, reply) => {
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);

      const target = await context.withoutTenant((tx) => resolveCallback(tx, request.params.slug));
      if (!target) {
        // The same answer an unknown path would give. Telling a stranger that a slug
        // exists but its signature was wrong turns this into an oracle for finding live
        // callback addresses.
        throw new NxError('NX-4041', { detail: 'no callback is registered at this address' });
      }

      const presented = request.headers[target.header.toLowerCase()];
      const signature = Array.isArray(presented) ? presented[0] : presented;
      if (!signature) {
        throw new NxError('NX-4011', { detail: 'this callback must be signed' });
      }

      const material = await context.secrets.fetch(target.secretRef);
      const secret = material['webhookSecret'] ?? material['secret'];
      if (!secret) {
        // Our own misconfiguration, and it is ours to fix rather than the caller's. It
        // must not read as a rejected signature, or an operator will spend the outage
        // looking at the provider's dashboard.
        throw new NxError('NX-5001', { detail: 'the callback secret is not set for this provider' });
      }

      if (!verifyProviderSignature(secret, body, signature, target.algorithm)) {
        throw new NxError('NX-4011', { detail: 'the signature does not match the body' });
      }

      let parsed: unknown = {};
      try {
        parsed = body.length > 0 ? (JSON.parse(body.toString('utf8')) as unknown) : {};
      } catch {
        // Signed by the provider and still not JSON. Recorded rather than dropped: the
        // delivery is genuine, and a body we cannot read is something to look at.
        parsed = {};
      }

      const result = await context.withoutTenant((tx) =>
        recordInboundEvent(tx, { target, body, parsed }),
      );

      // 202 for a first delivery and for a retry alike. A provider that is told anything
      // other than success retries, and a retry of an event we already hold must not
      // become a second piece of work.
      return reply.status(202).send({
        received: true,
        duplicate: result.duplicate,
      });
    });
  });
}
