import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { DEFAULT_RATE_LIMIT_RPM, rateLimitRpmFor, recordApiRequest } from '@nx-verify/core';
import { registerErrorHandler } from './errors.js';
import { registerIdempotencyRecorder } from './idempotency.js';
import { registerEvidenceRoutes, registerVerificationRoutes } from './routes/verifications.js';
import { registerProductRoutes } from './routes/products.js';
import { registerOperationsRoutes } from './routes/operations.js';
import { registerOnboardingRoutes } from './routes/onboarding.js';
import { registerCallbackRoutes } from './routes/callbacks.js';
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

  /**
   * The headers on every answer this service gives (SEC-03).
   *
   * Almost everything here is JSON for a program, and the one exception is a sealed document
   * a person opens: written when the seal was made, with its own styles inside it and no
   * script of any kind. So the policy allows a document to carry its own appearance and
   * nothing else at all: no script, no frame, no image from anywhere, and no page may put
   * this one inside itself.
   *
   * An answer is never stored: it carries a customer's verification, and a shared cache
   * between them and us is a place it could be read from.
   */
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header(
      'content-security-policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; " +
        "form-action 'none'; frame-ancestors 'none'",
    );
    reply.header('cache-control', 'no-store');
    if (process.env['NODE_ENV'] === 'production') {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  /**
   * The ceiling this workspace bought, not one ceiling for everybody (ADR-184).
   *
   * `packages.rate_limit_rpm` is sold at five different figures and was read by nothing: every
   * caller met the same 120, so an ENTERPRISE subscriber who paid for 600 calls a minute was
   * refused at a fifth of it, with a code that explained nothing. The plan's figure is read per
   * request and cached briefly, because a limiter that opens a database connection on every
   * call is a limiter that falls over exactly when it is needed.
   *
   * A request with no workspace yet (an unauthenticated one, or a bad key) keeps the process
   * wide default: there is no plan to ask about, and the limiter is also what stops somebody
   * guessing keys.
   */
  const ceilings = new Map<string, { rpm: number; expiresAt: number }>();
  const ceilingFor = async (tenantId: string): Promise<number> => {
    const cached = ceilings.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rpm;
    }
    const rpm = await options.context
      .withTenant(tenantId, (tx) => rateLimitRpmFor(tx))
      .catch(() => options.rateLimitMax ?? DEFAULT_RATE_LIMIT_RPM);
    ceilings.set(tenantId, { rpm, expiresAt: Date.now() + 60_000 });
    return rpm;
  };

  await app.register(rateLimit, {
    max: async (request) => {
      // An explicit ceiling is a test's or a deployment's, and it wins: somebody set it on
      // purpose. Everything else is the plan's.
      if (options.rateLimitMax !== undefined) {
        return options.rateLimitMax;
      }
      const caller = request.caller;
      return caller === undefined
        ? DEFAULT_RATE_LIMIT_RPM
        : await ceilingFor(caller.tenantId);
    },
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

  // Before the routes: an instance hook is not applied to a route registered earlier. The
  // other half of rule 7, the claim, runs inside `requireAuth` for the ordering written out
  // in idempotency.ts (ADR-183).
  registerIdempotencyRecorder(app, options.context);

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
  registerOnboardingRoutes(app, options.context);
  registerCallbackRoutes(app, options.context);

  return app;
}
