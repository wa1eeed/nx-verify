import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
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

  registerErrorHandler(app, options.context.registry);

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/openapi.json', async () => buildOpenApiDocument());

  registerProductRoutes(app, options.context);
  registerVerificationRoutes(app, options.context);
  registerEvidenceRoutes(app, options.context);
  registerOperationsRoutes(app, options.context);

  return app;
}
