import { z } from 'zod';
import {
  NxError,
  addToPortfolio,
  approveCase,
  assertNoProviderLeak,
  assignCase,
  audit,
  buildMonthlyReport,
  cancelBatch,
  confirmBatch,
  createBatch,
  createMonitor,
  createPortfolio,
  decideCase,
  getBatch,
  halalasToRiyals,
  listPortfolios,
  listQueue,
  portfolioHealth,
  previewBatch,
  returnCase,
  riskDashboard,
  riyalsToHalalas,
} from '@nx-verify/core';
import type { FastifyInstance } from 'fastify';
import { callerOf, requireAuth } from '../auth.js';
import type { AppContext } from '../context.js';

/**
 * The operational surface: the queue, portfolios, batches, monitoring and reporting.
 *
 * Everything the console can do is reachable here, because a compliance team that has to
 * open a browser to approve a case cannot put this platform inside their own workflow,
 * and putting it inside their workflow is what makes it hard to replace.
 *
 * Amounts cross this boundary in riyals, because that is what a customer's system deals
 * in. Halalas are an internal representation and stay internal (ADR-021).
 */

const decideBody = z.object({
  outcome: z.enum(['PASS', 'FAIL']),
  actor: z.string().min(1).max(128),
  note: z.string().min(1).max(2000),
});

const batchBody = z.object({
  product: z.string().min(1).max(64),
  actor: z.string().min(1).max(128),
  criteria: z.object({
    entity_type: z.string().max(32).optional(),
    portfolio_id: z.string().uuid().optional(),
    field_path: z.string().max(128).optional(),
    older_than_days: z.number().int().positive().optional(),
    missing_field: z.string().max(128).optional(),
    limit: z.number().int().positive().max(5000).optional(),
  }),
});

export function registerOperationsRoutes(app: FastifyInstance, context: AppContext): void {
  app.get(
    '/v1/review-cases',
    { preHandler: requireAuth(context, 'review:read') },
    async (request, reply) => {
      const caller = callerOf(request);
      const status = (request.query as { status?: string }).status;

      const cases = await context.withTenant(caller.tenantId, (tx) =>
        listQueue(tx, {
          ...(status === undefined ? {} : { status: status as never }),
          limit: 100,
        }),
      );

      return reply.send({
        cases: cases.map((item) => ({
          case_id: item.caseId,
          entity_id: item.entityId,
          verification_id: item.runId,
          status: item.status,
          reasons: item.reasonCodes,
          assigned_to: item.assignedTo,
          decided_by: item.decidedBy,
          age_hours: item.ageHours,
          overdue: item.overdue,
          sla_due_at: item.slaDueAt.toISOString(),
        })),
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/review-cases/:id/assign',
    { preHandler: requireAuth(context, 'review:write') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = z.object({ actor: z.string().min(1).max(128) }).parse(request.body);

      await context.withTenant(caller.tenantId, (tx) =>
        assignCase(tx, request.params.id, body.actor),
      );
      return reply.send({ case_id: request.params.id, status: 'ASSIGNED' });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/review-cases/:id/decide',
    { preHandler: requireAuth(context, 'review:write') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = decideBody.parse(request.body);

      await context.withTenant(caller.tenantId, (tx) =>
        decideCase(tx, {
          caseId: request.params.id,
          outcome: body.outcome,
          decidedBy: body.actor,
          note: body.note,
        }),
      );
      return reply.send({ case_id: request.params.id, status: 'DECIDED' });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/review-cases/:id/approve',
    { preHandler: requireAuth(context, 'review:approve') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = z.object({ actor: z.string().min(1).max(128) }).parse(request.body);

      // The database refuses an approver who decided. This surfaces that refusal as our
      // own 403 rather than a constraint violation.
      await context.withTenant(caller.tenantId, (tx) =>
        approveCase(tx, request.params.id, body.actor),
      );
      return reply.send({ case_id: request.params.id, status: 'CLOSED' });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/review-cases/:id/return',
    { preHandler: requireAuth(context, 'review:approve') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = z
        .object({ actor: z.string().min(1).max(128), reason: z.string().min(1).max(1000) })
        .parse(request.body);

      await context.withTenant(caller.tenantId, (tx) =>
        returnCase(tx, request.params.id, body.actor, body.reason),
      );
      return reply.send({ case_id: request.params.id, status: 'OPEN' });
    },
  );

  app.get(
    '/v1/portfolios',
    { preHandler: requireAuth(context, 'portfolios:read') },
    async (request, reply) => {
      const caller = callerOf(request);

      const payload = await context.withTenant(caller.tenantId, async (tx) => {
        const portfolios = await listPortfolios(tx);
        const health = await portfolioHealth(tx);
        const byId = new Map(health.map((entry) => [entry.portfolioId, entry]));
        return { portfolios, byId };
      });

      return reply.send({
        portfolios: payload.portfolios.map((portfolio) => ({
          portfolio_id: portfolio.id,
          code: portfolio.code,
          name_ar: portfolio.nameAr,
          name_en: portfolio.nameEn,
          entities: portfolio.memberCount,
          with_expired: payload.byId.get(portfolio.id)?.withExpired ?? 0,
          open_cases: payload.byId.get(portfolio.id)?.openCases ?? 0,
          monitoring:
            portfolio.monitorByDefault && portfolio.monitorBudget !== null
              ? {
                  cadence: portfolio.monitorCadence,
                  budget: halalasToRiyals(portfolio.monitorBudget),
                  currency: 'SAR',
                }
              : null,
        })),
      });
    },
  );

  app.post(
    '/v1/portfolios',
    { preHandler: requireAuth(context, 'portfolios:write') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = z
        .object({
          code: z.string().min(1).max(64),
          name_ar: z.string().min(1).max(200),
          name_en: z.string().min(1).max(200),
          default_product: z.string().max(64).optional(),
          monitor: z
            .object({
              cadence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'ON_EXPIRY']),
              budget: z.number().positive(),
            })
            .optional(),
        })
        .parse(request.body);

      const portfolioId = await context.withTenant(caller.tenantId, (tx) =>
        createPortfolio(tx, {
          code: body.code,
          nameAr: body.name_ar,
          nameEn: body.name_en,
          defaultProductCode: body.default_product ?? null,
          monitorByDefault: body.monitor !== undefined,
          monitorCadence: body.monitor?.cadence ?? null,
          monitorBudget: body.monitor ? riyalsToHalalas(body.monitor.budget) : null,
        }),
      );

      return reply.status(201).send({ portfolio_id: portfolioId });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/portfolios/:id/members',
    { preHandler: requireAuth(context, 'portfolios:write') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = z
        .object({ entity_id: z.string().uuid(), actor: z.string().min(1).max(128) })
        .parse(request.body);

      const result = await context.withTenant(caller.tenantId, (tx) =>
        addToPortfolio(tx, request.params.id, body.entity_id, body.actor),
      );

      return reply.status(result.added ? 201 : 200).send({
        added: result.added,
        // Named so a caller can see that joining this portfolio started monitoring, and
        // what it will cost them.
        monitor_id: result.monitorId,
      });
    },
  );

  app.post(
    '/v1/batches/preview',
    { preHandler: requireAuth(context, 'batches:write') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = batchBody.parse(request.body);

      const preview = await context.withTenant(caller.tenantId, (tx) =>
        previewBatch(tx, body.product, mapCriteria(body.criteria)),
      );

      return reply.send({
        entities: preview.entities,
        estimated_cost: halalasToRiyals(preview.estimatedCost),
        currency: 'SAR',
        exceeds_balance: preview.exceedsBalance,
        available_balance: halalasToRiyals(preview.availableBalance),
      });
    },
  );

  app.post(
    '/v1/batches',
    { preHandler: requireAuth(context, 'batches:write') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = batchBody.parse(request.body);

      const created = await context.withTenant(caller.tenantId, (tx) =>
        createBatch(tx, {
          productCode: body.product,
          criteria: mapCriteria(body.criteria),
          createdBy: body.actor,
          ...(body.criteria.portfolio_id === undefined
            ? {}
            : { portfolioId: body.criteria.portfolio_id }),
        }),
      );

      return reply.status(201).send({
        batch_id: created.batchId,
        status: 'DRAFT',
        entities: created.preview.entities,
        // The figure the caller must send back to confirm. A preview the system does not
        // hold itself to is decoration (ADR-037).
        estimated_cost: halalasToRiyals(created.preview.estimatedCost),
        currency: 'SAR',
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/batches/:id/confirm',
    { preHandler: requireAuth(context, 'batches:write') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = z
        .object({ actor: z.string().min(1).max(128), accepted_cost: z.number().nonnegative() })
        .parse(request.body);

      await context.withTenant(caller.tenantId, (tx) =>
        confirmBatch(tx, {
          batchId: request.params.id,
          confirmedBy: body.actor,
          acceptedCost: riyalsToHalalas(body.accepted_cost),
        }),
      );

      return reply.send({ batch_id: request.params.id, status: 'CONFIRMED' });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/batches/:id/cancel',
    { preHandler: requireAuth(context, 'batches:write') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = z.object({ actor: z.string().min(1).max(128) }).parse(request.body);

      await context.withTenant(caller.tenantId, (tx) =>
        cancelBatch(tx, request.params.id, body.actor),
      );
      return reply.send({ batch_id: request.params.id, status: 'CANCELLED' });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/batches/:id',
    { preHandler: requireAuth(context, 'batches:read') },
    async (request, reply) => {
      const caller = callerOf(request);
      const batch = await context.withTenant(caller.tenantId, (tx) =>
        getBatch(tx, request.params.id),
      );

      if (!batch) {
        throw new NxError('NX-4041', { requestId: request.id });
      }

      return reply.send({
        batch_id: batch.batchId,
        product: batch.productCode,
        status: batch.status,
        entities: batch.estimatedEntities,
        done: batch.done,
        failed: batch.failed,
        pending: batch.pending,
        estimated_cost: halalasToRiyals(batch.estimatedCost),
        actual_cost: halalasToRiyals(batch.actualCost),
        currency: 'SAR',
      });
    },
  );

  app.post(
    '/v1/monitors',
    { preHandler: requireAuth(context, 'monitors:write') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = z
        .object({
          entity_id: z.string().uuid(),
          product: z.string().min(1).max(64),
          fields: z.array(z.string().min(1).max(128)).min(1),
          cadence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'ON_EXPIRY']),
          // Not optional, and not defaulted. A monitor draws from a balance automatically,
          // and a surprise invoice ends the relationship faster than an outage.
          budget: z.number().positive(),
          actor: z.string().min(1).max(128),
          consent_ref: z.string().max(200).optional(),
        })
        .parse(request.body);

      const monitorId = await context.withTenant(caller.tenantId, async (tx) => {
        const id = await createMonitor(tx, {
          entityId: body.entity_id,
          productCode: body.product,
          fieldPaths: body.fields,
          cadence: body.cadence,
          budgetCapPerPeriod: riyalsToHalalas(body.budget),
          activatedBy: body.actor,
          consentRef: body.consent_ref ?? null,
        });

        await audit(tx, {
          actorType: 'API_KEY',
          actorId: caller.apiKeyId,
          action: 'monitor.activated',
          target: id,
          requestId: request.id,
          metadata: { cadence: body.cadence, activated_by: body.actor },
        });

        return id;
      });

      return reply.status(201).send({ monitor_id: monitorId });
    },
  );

  app.get(
    '/v1/dashboard',
    { preHandler: requireAuth(context, 'reports:read') },
    async (request, reply) => {
      const caller = callerOf(request);
      const dashboard = await context.withTenant(caller.tenantId, (tx) => riskDashboard(tx));

      const response = {
        entities: dashboard.entities,
        entities_with_expired: dashboard.entitiesWithExpired,
        field_freshness: dashboard.fieldFreshness,
        open_changes: dashboard.openChanges,
        review_queue: dashboard.reviewQueue,
        monitors: dashboard.monitors,
        wallet: {
          balance: halalasToRiyals(dashboard.wallet.balance),
          held: halalasToRiyals(dashboard.wallet.held),
          is_low: dashboard.wallet.isLow,
          currency: 'SAR',
        },
      };

      assertNoProviderLeak(response, context.registry.names());
      return reply.send(response);
    },
  );

  app.get(
    '/v1/reports/monthly',
    { preHandler: requireAuth(context, 'reports:read') },
    async (request, reply) => {
      const caller = callerOf(request);
      const month = (request.query as { month?: string }).month;
      const when = month === undefined ? new Date() : new Date(`${month}-01T00:00:00Z`);

      if (Number.isNaN(when.getTime())) {
        throw new NxError('NX-4001', { detail: 'month must be YYYY-MM', requestId: request.id });
      }

      const report = await context.withTenant(caller.tenantId, (tx) =>
        buildMonthlyReport(tx, when),
      );

      return reply.send({
        month: report.month,
        verifications: report.verifications,
        decisions: report.decisions,
        changes_detected: report.changesDetected,
        review_cases: {
          opened: report.reviewCases.opened,
          closed: report.reviewCases.closed,
          median_hours_to_close: report.reviewCases.medianHoursToClose,
        },
        spend: { total: halalasToRiyals(report.spend.total), currency: report.spend.currency },
        entities_covered_without_spend: report.entitiesCoveredWithoutSpend,
      });
    },
  );
}

function mapCriteria(criteria: z.infer<typeof batchBody>['criteria']): {
  entityType?: string;
  portfolioId?: string;
  fieldPath?: string;
  olderThanDays?: number;
  missingField?: string;
  limit?: number;
} {
  return {
    ...(criteria.entity_type === undefined ? {} : { entityType: criteria.entity_type }),
    ...(criteria.portfolio_id === undefined ? {} : { portfolioId: criteria.portfolio_id }),
    ...(criteria.field_path === undefined ? {} : { fieldPath: criteria.field_path }),
    ...(criteria.older_than_days === undefined ? {} : { olderThanDays: criteria.older_than_days }),
    ...(criteria.missing_field === undefined ? {} : { missingField: criteria.missing_field }),
    ...(criteria.limit === undefined ? {} : { limit: criteria.limit }),
  };
}
