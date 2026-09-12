import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { recordApiRequest } from '@nx-verify/core';
import { registerErrorHandler } from './errors.js';
import { registerEvidenceRoutes, registerVerificationRoutes } from './routes/verifications.js';
import { registerProductRoutes } from './routes/products.js';
import { registerOperationsRoutes } from './routes/operations.js';
import { buildOpenApiDocument } from './openapi.js';
import type { AppContext } from './context.js';

export interface BuildAppOptions {
  context: AppContext;
  logger?: boolean;
  rateLimitMax?: number;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // A request id on every response, and in every error body. It is the first thing
    // support asks for and the last thing anyone remembers to add.
    genReqId: () => `req_${Math.random().toString(36).slice(2, 12)}`,
    // Rule 4: never let a URL carry an identifier, so query strings stay short and
    // bodies carry the subject.
    bodyLimit: 256 * 1024,
  });

  await app.register(rateLimit, {
    max: options.rateLimitMax ?? 120,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const header = request.headers.authorization;
      // Limit per key, not per address. Several customers behind one gateway must not
      // consume each other's allowance.
      return header ? header.slice(-16) : request.ip;
    },
  });

  /**
   * Every call is written down, after the reply has gone.
   *
   * onResponse runs once the client already has its answer, so the write cannot slow a
   * request down, and a failure to log must never fail a call that already succeeded: the
   * customer's work matters more than our record of it.
   *
   * The route is recorded rather than the address. A path carries values, and values are
   * the one thing rule 4 keeps out of logs.
   */
  app.addHook('onResponse', async (request, reply) => {
    const caller = request.caller;
    if (!caller) {
      // Nothing authenticated, so there is no workspace to write it against. A rejected
      // key is still counted, in the rate limiter and in the error it received.
      return;
    }

    try {
      await options.context.withTenant(caller.tenantId, (tx) =>
        recordApiRequest(tx, {
          apiKeyId: caller.apiKeyId,
          requestId: String(request.id),
          method: request.method,
          route: request.routeOptions.url ?? request.url.split('?')[0] ?? '/',
          status: reply.statusCode,
          latencyMs: reply.elapsedTime,
          errorCode: reply.getHeader('x-nx-error-code')?.toString() ?? null,
          environment: caller.environment,
        }),
      );
    } catch {
      // Deliberately swallowed. See above.
    }
  });

  registerErrorHandler(app, options.context.registry);

  /**
   * Liveness: the process is running and answering.
   *
   * It deliberately checks nothing else. An orchestrator restarts a container that fails
   * this, and restarting the API does not fix a database that is down: it only removes
   * the instance that could have told anyone what was wrong.
   */
  app.get('/health', async () => ({ status: 'ok' }));

  /**
   * Readiness: this instance can actually serve a request.
   *
   * A health check that always says ok is a health check that lies, and the two ways this
   * process is up but useless are a database it cannot reach and a key service it cannot
   * ask. Both are checked, and neither answer carries a reason a stranger could use: the
   * body names which check failed and never why.
   */
  app.get('/ready', async (_request, reply) => {
    const checks: Record<string, boolean> = { database: false, keys: false };

    try {
      await options.context.withoutTenant((tx) => tx.query('SELECT 1'));
      checks['database'] = true;
    } catch {
      checks['database'] = false;
    }

    try {
      await options.context.keys.currentVersion();
      checks['keys'] = true;
    } catch {
      checks['keys'] = false;
    }

    const ready = Object.values(checks).every(Boolean);
    return reply.status(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks });
  });
  app.get('/openapi.json', async () => buildOpenApiDocument());

  registerProductRoutes(app, options.context);
  registerVerificationRoutes(app, options.context);
  registerEvidenceRoutes(app, options.context);
  registerOperationsRoutes(app, options.context);

  return app;
}
