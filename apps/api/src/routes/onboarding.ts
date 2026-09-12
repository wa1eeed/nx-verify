import { z } from 'zod';
import {
  NxError,
  advanceCase,
  getCase,
  listCases,
  listJourneys,
  openOnboardingCase,
  waiveStep,
  type WaiveReason,
} from '@nx-verify/core';
import { assertNoProviderLeak } from '@nx-verify/core';
import { inferIdentifiers } from './verifications.js';
import { callerOf, requireAuth } from '../auth.js';
import type { AppContext } from '../context.js';
import type { FastifyInstance } from 'fastify';

/**
 * Onboarding over HTTP.
 *
 * This is the call the product is named for. A customer does not ask us to verify a
 * business; they ask us to onboard a merchant, and one request runs every check their
 * journey requires, applies their own rules, and comes back with a decision, a reference
 * and what is still outstanding.
 *
 * The applicant's details are sent on every call and stored nowhere (rule 4), which is
 * why advancing a case takes the subject again rather than remembering it.
 */

const openEnvelope = z.object({
  journey: z.string().min(1).max(32),
  subject: z.record(z.unknown()),
  reference: z.string().max(128).optional(),
  display_name: z.string().max(200).optional(),
  identifiers: z
    .array(
      z.object({
        type: z.string().min(1).max(32),
        value: z.string().min(1).max(64),
      }),
    )
    .min(1)
    .optional(),
});

const advanceEnvelope = z.object({
  subject: z.record(z.unknown()),
  identifiers: z
    .array(z.object({ type: z.string().min(1).max(32), value: z.string().min(1).max(64) }))
    .min(1)
    .optional(),
});

const waiveEnvelope = z.object({
  step: z.string().min(1).max(64),
  reason: z.enum(['ALREADY_VERIFIED_ELSEWHERE', 'NOT_APPLICABLE', 'DOCUMENT_ON_FILE', 'RISK_ACCEPTED']),
  actor: z.string().uuid(),
});

export function registerOnboardingRoutes(app: FastifyInstance, context: AppContext): void {
  app.get(
    '/v1/onboarding/journeys',
    { preHandler: requireAuth(context, 'onboarding:read') },
    async (request, reply) => {
      const caller = callerOf(request);
      const journeys = await context.withTenant(caller.tenantId, (tx) => listJourneys(tx));

      return reply.send({
        journeys: journeys.map((journey) => ({
          code: journey.code,
          name_ar: journey.nameAr,
          sla_hours: journey.slaHours,
          steps: journey.steps.map((step) => ({
            step: step.stepKey,
            product: step.productCode,
            required: step.required,
          })),
        })),
      });
    },
  );

  /**
   * Open a file and run it.
   *
   * One call rather than two, because a customer onboarding a merchant wants an answer,
   * not a handle. A file that needs a person comes back saying so, with the checks that
   * are done and the ones that are not.
   */
  app.post(
    '/v1/onboarding/cases',
    { preHandler: requireAuth(context, 'onboarding:write') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = openEnvelope.parse(request.body);
      const identifiers = body.identifiers
        ? body.identifiers.map((entry) => ({
            idType: entry.type as 'UNN',
            value: entry.value,
          }))
        : inferIdentifiers(body.subject);

      if (identifiers.length === 0) {
        throw new NxError('NX-4001', {
          detail: 'the applicant carries no identifier and none was supplied',
          requestId: request.id,
        });
      }

      const registry = await context.registryFor(caller.environment);

      const result = await context.withTenant(caller.tenantId, async (tx) => {
        const opened = await openOnboardingCase(tx, {
          journeyCode: body.journey,
          clientRef: body.reference ?? null,
        });

        return advanceCase(tx, {
          caseId: opened.caseId,
          subject: body.subject,
          subjectIdentifiers: identifiers,
          ...(body.display_name === undefined ? {} : { subjectDisplayName: body.display_name }),
          runStep: context.stepRunnerFor(tx, { registry }),
          keys: context.keys,
        });
      });

      const response = caseResponse(caller.environment, result.case);
      assertNoProviderLeak(response, context.registry.names());
      return reply.status(201).send(response);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/onboarding/cases/:id',
    { preHandler: requireAuth(context, 'onboarding:read') },
    async (request, reply) => {
      const caller = callerOf(request);
      const found = await context.withTenant(caller.tenantId, (tx) =>
        getCase(tx, request.params.id),
      );

      if (!found) {
        throw new NxError('NX-4041', { requestId: request.id });
      }

      const response = caseResponse(caller.environment, found);
      assertNoProviderLeak(response, context.registry.names());
      return reply.send(response);
    },
  );

  app.get(
    '/v1/onboarding/cases',
    { preHandler: requireAuth(context, 'onboarding:read') },
    async (request, reply) => {
      const caller = callerOf(request);
      const cases = await context.withTenant(caller.tenantId, (tx) => listCases(tx, { limit: 100 }));

      return reply.send({
        environment: caller.environment,
        cases: cases.map((row) => ({
          case_id: row.caseId,
          reference: row.reference,
          journey: row.journeyCode,
          status: row.status,
          outcome: row.outcome,
          done: row.done,
          total: row.total,
          due_at: row.dueAt.toISOString(),
          overdue: row.overdue,
        })),
      });
    },
  );

  /** Runs whatever the file still needs. The applicant's details come again (rule 4). */
  app.post<{ Params: { id: string } }>(
    '/v1/onboarding/cases/:id/advance',
    { preHandler: requireAuth(context, 'onboarding:write') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = advanceEnvelope.parse(request.body);
      const identifiers = body.identifiers
        ? body.identifiers.map((entry) => ({ idType: entry.type as 'UNN', value: entry.value }))
        : inferIdentifiers(body.subject);

      // Resolved before the transaction opens: the registry is configuration and does not
      // belong inside a transaction that is about to call a provider.
      const registry = await context.registryFor(caller.environment);

      const result = await context.withTenant(caller.tenantId, (tx) =>
        advanceCase(tx, {
          caseId: request.params.id,
          subject: body.subject,
          subjectIdentifiers: identifiers,
          runStep: context.stepRunnerFor(tx, { registry }),
          keys: context.keys,
        }),
      );

      const response = caseResponse(caller.environment, result.case);
      assertNoProviderLeak(response, context.registry.names());
      return reply.send(response);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/onboarding/cases/:id/waive',
    { preHandler: requireAuth(context, 'onboarding:write') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = waiveEnvelope.parse(request.body);

      const updated = await context.withTenant(caller.tenantId, async (tx) => {
        await waiveStep(tx, {
          caseId: request.params.id,
          stepKey: body.step,
          reason: body.reason as WaiveReason,
          actorId: body.actor,
        });
        return getCase(tx, request.params.id);
      });

      if (!updated) {
        throw new NxError('NX-4041', { requestId: request.id });
      }

      return reply.send(caseResponse(caller.environment, updated));
    },
  );
}

/** The envelope, ours and identical in both environments but for one field. */
function caseResponse(
  environment: 'sandbox' | 'live',
  onboarding: Awaited<ReturnType<typeof getCase>>,
): Record<string, unknown> {
  if (!onboarding) {
    throw new NxError('NX-4041');
  }

  return {
    environment,
    case_id: onboarding.caseId,
    reference: onboarding.reference,
    journey: onboarding.journeyCode,
    status: onboarding.status,
    outcome: onboarding.outcome,
    entity_id: onboarding.entityId,
    client_ref: onboarding.clientRef,
    due_at: onboarding.dueAt.toISOString(),
    overdue: onboarding.overdue,
    // Every check and what became of it: a customer reading this knows what is still
    // outstanding without asking.
    steps: onboarding.steps.map((step) => ({
      step: step.stepKey,
      product: step.productCode,
      required: step.required,
      status: step.status,
      verification_id: step.runId,
      waived_reason: step.waiveReason,
    })),
  };
}
