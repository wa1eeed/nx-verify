import { SEED_PRODUCTS } from '@nx-verify/db';

/**
 * OpenAPI 3.1, generated rather than written.
 *
 * A hand written specification drifts from the implementation the first time either
 * changes, and the customer only discovers it at the worst moment. This is built from the
 * same route definitions the server registers.
 *
 * The product schemas are not listed here, deliberately. They live in the database and
 * are served by GET /v1/products, so a new product appears in discovery immediately
 * without regenerating anything.
 */

export interface OpenApiOptions {
  serverUrl?: string;
  version?: string;
}

export function buildOpenApiDocument(options: OpenApiOptions = {}): Record<string, unknown> {
  const errorSchema = {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message_ar', 'message_en', 'retryable'],
        properties: {
          code: { type: 'string', example: 'NX-4021' },
          message_ar: { type: 'string' },
          message_en: { type: 'string' },
          retryable: { type: 'boolean' },
          request_id: { type: 'string' },
        },
      },
    },
  };

  const stepResult = {
    type: 'object',
    required: ['status'],
    properties: {
      status: { enum: ['OK', 'NOT_FOUND', 'ERROR', 'SKIPPED', 'CACHED'] },
      // The official body. The provider behind it is never named (rule 5).
      authority: { type: 'string' },
      reason: { type: 'string' },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'NX Verify API',
      version: options.version ?? '1.0.0',
      description:
        'Verification and compliance API. Every field carries the authority that issued it and the time it was observed.',
    },
    servers: [{ url: options.serverUrl ?? 'https://api.nx.sa' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        Error: errorSchema,
        StepResult: stepResult,
        Verification: {
          type: 'object',
          required: ['verification_id', 'product', 'status', 'results'],
          properties: {
            verification_id: { type: 'string', format: 'uuid' },
            product: { type: 'string' },
            status: { enum: ['OK', 'PARTIAL', 'NOT_FOUND', 'ERROR'] },
            decision: { enum: ['PASS', 'FAIL', 'REVIEW', null] },
            entity_id: { type: ['string', 'null'], format: 'uuid' },
            results: { type: 'object', additionalProperties: stepResult },
            billing: {
              type: 'object',
              properties: {
                amount: { type: 'number' },
                currency: { type: 'string', example: 'SAR' },
              },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/v1/products': {
        get: {
          summary: 'List the products available to this account, with their input schemas',
          description:
            'The input schema travels with each product, so a client can generate its own form and needs no change when a product is added.',
          responses: {
            '200': { description: 'The catalogue' },
            '401': { description: 'Invalid credentials', content: jsonError(errorSchema) },
          },
        },
      },
      '/v1/verifications': {
        post: {
          summary: 'Run a verification',
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              schema: { type: 'string' },
              description:
                'The same key returns the same result and is charged once. Send one for every request that costs money.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['product', 'subject'],
                  properties: {
                    product: { type: 'string', examples: SEED_PRODUCTS.map((p) => p.code) },
                    subject: {
                      type: 'object',
                      description:
                        'Validated against the schema published for this product by GET /v1/products.',
                    },
                    reference: {
                      type: 'string',
                      description:
                        'Your own reference. It is returned on every later event about this entity.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Completed', content: jsonRef('Verification') },
            '200': {
              description: 'Replayed under the same Idempotency-Key',
              content: jsonRef('Verification'),
            },
            '422': {
              description: 'The subject does not match the product schema',
              content: jsonError(errorSchema),
            },
          },
        },
      },
      '/v1/verifications/{id}': {
        get: {
          summary: 'Read a verification',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'The verification', content: jsonRef('Verification') },
            '404': { description: 'Not found', content: jsonError(errorSchema) },
          },
        },
      },
      '/v1/verifications/{id}/document': {
        get: {
          summary: 'Download the sealed evidence document',
          description:
            'The Arabic document as it was rendered when the run was sealed. Served, never regenerated, so the hash printed on a copy in circulation keeps matching.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'The document',
              content: { 'text/html': { schema: { type: 'string' } } },
            },
            '404': { description: 'Not found', content: jsonError(errorSchema) },
          },
        },
      },
      '/v1/entities/{id}': {
        get: {
          summary: 'Read the live profile of an entity',
          description:
            'Every field carries authority, observed_at and a freshness state computed from the retention policy in force now.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'The profile' } },
        },
      },
      '/v1/wallet': {
        get: {
          summary: 'Read the service balance',
          responses: { '200': { description: 'The balance' } },
        },
      },
      '/v1/evidence/{token}': {
        get: {
          summary: 'Confirm a sealed evidence document',
          description:
            'Public and unauthenticated, because the holder of a printed document has no account. Returns the content hash and the sealing time only, and no personal data.',
          parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
          security: [],
          responses: {
            '200': { description: 'The seal' },
            '404': { description: 'Unknown token' },
          },
        },
      },
      '/v1/review-cases': {
        get: {
          summary: 'List review cases, oldest and latest first',
          responses: { '200': { description: 'The queue' } },
        },
      },
      '/v1/review-cases/{id}/decide': {
        post: {
          summary: 'Decide a case',
          description:
            'A written reason is required. It is the one free text field in the platform.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Decided' } },
        },
      },
      '/v1/review-cases/{id}/approve': {
        post: {
          summary: 'Approve a decided case',
          description:
            'Four eyes. The person who decided a case cannot approve it, and the database refuses it as well as the API.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Approved and closed' },
            '403': {
              description: 'The approver decided this case',
              content: jsonError(errorSchema),
            },
          },
        },
      },
      '/v1/portfolios': {
        get: {
          summary: 'List portfolios with their policy and health',
          responses: { '200': { description: 'Portfolios' } },
        },
        post: { summary: 'Create a portfolio', responses: { '201': { description: 'Created' } } },
      },
      '/v1/batches/preview': {
        post: {
          summary: 'Count and price a batch without creating it',
          description: 'Writes nothing. A preview is a question.',
          responses: { '200': { description: 'The estimate' } },
        },
      },
      '/v1/batches/{id}/confirm': {
        post: {
          summary: 'Confirm a batch against the figure that was shown',
          description:
            'accepted_cost must equal the estimate. If it has moved since, the batch is refused rather than run at the new number.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Confirmed' },
            '422': { description: 'The estimate changed', content: jsonError(errorSchema) },
          },
        },
      },
      '/v1/monitors': {
        post: {
          summary: 'Start monitoring an entity',
          description:
            'A budget is required and is not defaulted. Monitoring spends the balance automatically, so the cap and the person who activated it are both recorded.',
          responses: { '201': { description: 'Monitoring started' } },
        },
      },
      '/v1/dashboard': {
        get: {
          summary: 'Portfolio health at a glance',
          responses: { '200': { description: 'The dashboard' } },
        },
      },
      '/v1/reports/monthly': {
        get: {
          summary: 'The monthly report',
          parameters: [
            {
              name: 'month',
              in: 'query',
              required: false,
              schema: { type: 'string', example: '2026-09' },
            },
          ],
          responses: { '200': { description: 'The report' } },
        },
      },
    },
  };
}

function jsonRef(name: string): Record<string, unknown> {
  return { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } };
}

function jsonError(schema: unknown): Record<string, unknown> {
  return { 'application/json': { schema } };
}
