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
    assertScope(caller, scope);
    request.caller = caller;
  };
}

export function callerOf(request: FastifyRequest): AuthenticatedCaller {
  const caller = request.caller;
  if (!caller) {
    throw new NxError('NX-4011', { requestId: request.id });
  }
  return caller;
}
