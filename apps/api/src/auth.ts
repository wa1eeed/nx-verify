import { authenticate, assertScope, NxError, type AuthenticatedCaller } from '@nx-verify/core';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from './context.js';

declare module 'fastify' {
  interface FastifyRequest {
    caller?: AuthenticatedCaller;
  }
}

/**
 * Bearer authentication.
 *
 * The key resolves to a tenant, and from that point every database access in the request
 * goes through withTenant with that id. There is no code path in the API that reaches the
 * database without a tenant in scope, which is what makes rule 2 structural rather than a
 * habit.
 */
export function requireAuth(context: AppContext, scope: string) {
  return async function authHook(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new NxError('NX-4011', { requestId: request.id });
    }

    const caller = await context.withoutTenant((tx) => authenticate(tx, header.slice(7)));
    // Attached before the scope is checked, not after. The key authenticated; it simply
    // may not do this. A refusal that cannot be attributed to the workspace that made it
    // is a refusal missing from that workspace's own request log, and a scope refusal is
    // the call a customer asks about most.
    request.caller = caller;
    assertScope(caller, scope);
  };
}

export function callerOf(request: FastifyRequest): AuthenticatedCaller {
  const caller = request.caller;
  if (!caller) {
    throw new NxError('NX-4011', { requestId: request.id });
  }
  return caller;
}
