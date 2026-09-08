import {
  getEntityProfile,
  getRelations,
  getWallet,
  halalasToRiyals,
  listProducts,
  resolvePrice,
  NxError,
} from '@nx-verify/core';
import type { FastifyInstance } from 'fastify';
import { callerOf, requireAuth } from '../auth.js';
import type { AppContext } from '../context.js';

/**
 * Discovery and read endpoints.
 *
 * GET /v1/products returns each product with its input schema and this customer's price,
 * so their own form is generated from the response. That is why adding a product needs no
 * change on their side either (docs/03-products.md section 8).
 */
export function registerProductRoutes(app: FastifyInstance, context: AppContext): void {
  app.get(
    '/v1/products',
    { preHandler: requireAuth(context, 'products:read') },
    async (request, reply) => {
      const caller = callerOf(request);

      const products = await context.withTenant(caller.tenantId, async (tx) => {
        const catalog = await listProducts(tx);
        return Promise.all(
          catalog.map(async (product) => {
            const price = await resolvePrice(tx, product.code).catch(() => null);
            return {
              code: product.code,
              name_ar: product.nameAr,
              name_en: product.nameEn,
              subject_type: product.subjectType,
              is_composite: product.isComposite,
              input_schema: product.inputSchema,
              price:
                price === null
                  ? null
                  : {
                      // Prices are stored without VAT and VAT is added at presentation.
                      amount: halalasToRiyals(price.unitPrice),
                      currency: 'SAR',
                      negative_pct: price.negativePct,
                    },
            };
          }),
        );
      });

      return reply.send({ products });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/entities/:id',
    { preHandler: requireAuth(context, 'entities:read') },
    async (request, reply) => {
      const caller = callerOf(request);

      const payload = await context.withTenant(caller.tenantId, async (tx) => {
        const profile = await getEntityProfile(tx, request.params.id);
        if (profile.length === 0) {
          return null;
        }
        const relations = await getRelations(tx, request.params.id);
        return { profile, relations };
      });

      if (!payload) {
        throw new NxError('NX-4041', { requestId: request.id });
      }

      return reply.send({
        entity_id: request.params.id,
        // Rule 6: every field carries its authority and its timestamp. Rule 5: the
        // provider is not among them.
        fields: payload.profile.map((field) => ({
          field_path: field.fieldPath,
          value: field.value,
          authority: field.authority,
          observed_at: field.observedAt.toISOString(),
          effective_until: field.effectiveUntil?.toISOString() ?? null,
          freshness: field.freshness,
          confidence: field.confidence,
        })),
        relations: payload.relations.map((edge) => ({
          type: edge.relType,
          from_entity: edge.fromEntity,
          to_entity: edge.toEntity,
          valid_from: edge.validFrom.toISOString(),
        })),
      });
    },
  );

  app.get(
    '/v1/wallet',
    { preHandler: requireAuth(context, 'wallet:read') },
    async (request, reply) => {
      const caller = callerOf(request);
      const wallet = await context.withTenant(caller.tenantId, (tx) => getWallet(tx));

      return reply.send({
        balance: halalasToRiyals(wallet.balance),
        held: halalasToRiyals(wallet.held),
        available: halalasToRiyals(wallet.available),
        currency: wallet.currency,
        is_low: wallet.isLow,
      });
    },
  );
}
