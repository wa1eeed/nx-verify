import { z } from 'zod';
import {
  NxError,
  assertNoProviderLeak,
  audit,
  buildEvidenceContent,
  buildEvidenceDocument,
  evidenceStorageKey,
  getVerification,
  halalasToRiyals,
  renderEvidenceHtml,
  resolvePublicEvidence,
  sealEvidence,
  verify,
  type IdentifierInput,
} from '@nx-verify/core';
import type { FastifyInstance } from 'fastify';
import { callerOf, requireAuth } from '../auth.js';
import type { AppContext } from '../context.js';

/**
 * POST /v1/verifications and GET /v1/verifications/:id
 *
 * docs/03-products.md section 0: the request shape varies by product, the response shape
 * never does. The envelope below is fixed and validated by Zod; the subject inside it is
 * validated against the product's own JSON Schema, which lives in a database row.
 */

const IDENTIFIER_TYPES = [
  'CR',
  'UNN',
  'NATIONAL_ID',
  'IQAMA',
  'FREELANCE_DOC',
  'IBAN',
  'REAL_ESTATE_NO',
] as const;

const envelope = z.object({
  product: z.string().min(1).max(64),
  subject: z.record(z.unknown()),
  reference: z.string().max(128).optional(),
  identifiers: z
    .array(
      z.object({
        type: z.enum(IDENTIFIER_TYPES),
        value: z.string().min(1).max(64),
        primary: z.boolean().optional(),
      }),
    )
    .min(1)
    .optional(),
  display_name: z.string().max(200).optional(),
});

export function registerVerificationRoutes(app: FastifyInstance, context: AppContext): void {
  app.post(
    '/v1/verifications',
    { preHandler: requireAuth(context, 'verifications:write') },
    async (request, reply) => {
      const caller = callerOf(request);
      const body = envelope.parse(request.body);
      const idempotencyKey = headerValue(request.headers['idempotency-key']);

      /**
       * A forced answer, in a sandbox only.
       *
       * A customer's QA team writes a case called "expired registration" and wants to run
       * it. Honouring the header for a live key would let a caller choose its own result,
       * which would make every result from this platform meaningless, so the check is on
       * the environment of the key rather than on anything the request says about itself.
       */
      const testScenario =
        caller.environment === 'sandbox'
          ? headerValue(request.headers['x-nx-test-scenario'])
          : null;

      const identifiers = body.identifiers
        ? body.identifiers.map((entry): IdentifierInput => ({
            idType: entry.type,
            value: entry.value,
            ...(entry.primary === undefined ? {} : { isPrimary: entry.primary }),
          }))
        : inferIdentifiers(body.subject);

      if (identifiers.length === 0) {
        throw new NxError('NX-4001', {
          detail: 'the subject carries no identifier and none was supplied',
          requestId: request.id,
        });
      }

      // Resolved before the transaction: the registry is configuration, not work.
      const registry = await context.registryFor(caller.environment);

      const result = await context.withTenant(caller.tenantId, async (tx) => {
        const outcome = await verify(tx, {
          productCode: body.product,
          subject: body.subject,
          subjectIdentifiers: identifiers,
          subjectDisplayName: body.display_name,
          idempotencyKey,
          clientRef: body.reference ?? null,
          triggeredBy: 'API',
          modeAtExecution: 'BYOC',
          // The adapter for the world this key belongs to: a sandbox key reaches each
          // provider's sandbox host, a live key its production one.
          runStep: context.stepRunnerFor(tx, {
            ...(testScenario === null ? {} : { testScenario }),
            registry,
          }),
          keys: context.keys,
        });

        await audit(tx, {
          actorType: 'API_KEY',
          actorId: caller.apiKeyId,
          action: outcome.replayed ? 'verification.replayed' : 'verification.created',
          target: outcome.runId,
          ip: request.ip,
          requestId: request.id,
          metadata: { product: body.product, status: outcome.status },
        });

        // The evidence file is sealed as part of the run, not on request. A document
        // that has to be generated later can be generated differently later, and the
        // whole point of this record is that it cannot.
        let evidenceToken: string | null = null;
        if (!outcome.replayed && outcome.status !== 'ERROR') {
          const content = await buildEvidenceContent(tx, outcome.runId);
          const keyVersion = await context.keys.currentVersion();
          const sealed = await sealEvidence(tx, {
            runId: outcome.runId,
            content,
            storageKey: `evidence/${caller.tenantId}/${outcome.runId}.html`,
            signingKey: await context.keys.signingKey(caller.tenantId, keyVersion),
            keyVersion,
          });
          // The document is produced with the seal, not on request. One that has to be
          // generated later can be generated differently later, and the whole point of
          // this record is that it cannot.
          const evidenceDocument = await buildEvidenceDocument(tx, {
            content,
            contentHash: sealed.contentHash,
            publicToken: sealed.publicToken,
            verifyBaseUrl: context.publicBaseUrl,
          });
          await context.evidence.put(
            `evidence/${caller.tenantId}/${outcome.runId}.html`,
            await renderEvidenceHtml(evidenceDocument),
          );

          evidenceToken = sealed.publicToken;
        }

        return { ...outcome, evidenceToken };
      });

      const response = {
        // First, because it changes what everything below it means. A test integration
        // that cannot tell which world answered is a test integration that will one day
        // read a sandbox result as a real one.
        environment: caller.environment,
        verification_id: result.runId,
        // The number support conversations are held with. The id stays the identifier.
        reference: result.reference,
        product: body.product,
        status: result.status,
        decision: result.decision?.outcome ?? null,
        decision_reasons:
          result.decision?.reasons.map((reason) => ({
            code: reason.code,
            message_ar: reason.messageAr,
            message_en: reason.messageEn,
          })) ?? [],
        entity_id: result.entityId,
        results: result.results,
        billing: {
          amount: halalasToRiyals(result.billing.amount),
          currency: result.billing.currency,
        },
        // A field no provider has, and one of the reasons our response resembles none of
        // theirs (ADR-006). It opens a page showing the seal and nothing else.
        evidence_url: result.evidenceToken === null ? null : `/v1/evidence/${result.evidenceToken}`,
        replayed: result.replayed,
      };

      // Rule 5, checked on the way out rather than trusted.
      assertNoProviderLeak(response, context.registry.names());
      return reply.status(result.replayed ? 200 : 201).send(response);
    },
  );

  /**
   * The rendered document for a run.
   *
   * Served rather than generated here: the file was written when the seal was made, and a
   * document that can be regenerated on request can be regenerated differently, which is
   * the one thing a sealed record must not allow.
   */
  app.get<{ Params: { id: string } }>(
    '/v1/verifications/:id/document',
    { preHandler: requireAuth(context, 'verifications:read') },
    async (request, reply) => {
      const caller = callerOf(request);
      const key = await context.withTenant(caller.tenantId, (tx) =>
        evidenceStorageKey(tx, request.params.id),
      );

      const html = key === null ? null : await context.evidence.get(key);
      if (html === null) {
        throw new NxError('NX-4041', { requestId: request.id });
      }

      return reply.type('text/html; charset=utf-8').send(html);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/verifications/:id',
    { preHandler: requireAuth(context, 'verifications:read') },
    async (request, reply) => {
      const caller = callerOf(request);
      const run = await context.withTenant(caller.tenantId, (tx) =>
        getVerification(tx, request.params.id),
      );

      if (!run) {
        throw new NxError('NX-4041', { requestId: request.id });
      }

      const results: Record<string, { status: string; reason?: string }> = {};
      for (const step of run.steps) {
        results[step.stepKey] = {
          status: step.status,
          ...(step.skippedBecause ? { reason: step.skippedBecause } : {}),
        };
      }

      const response = {
        environment: caller.environment,
        verification_id: run.runId,
        reference: run.reference,
        product: run.productCode,
        status: run.status,
        decision: run.decision,
        entity_id: run.entityId,
        client_ref: run.clientRef,
        results,
        created_at: run.createdAt.toISOString(),
      };

      assertNoProviderLeak(response, context.registry.names());
      return reply.send(response);
    },
  );
}

/**
 * The public evidence check, behind the QR code on the document.
 *
 * No authentication, because the person holding the document has no account here. It
 * returns the content hash and the sealing time and nothing else: no name, no identifier,
 * no field values. A public verification page that leaks personal data is worse than not
 * having one.
 */
export function registerEvidenceRoutes(app: FastifyInstance, context: AppContext): void {
  app.get<{ Params: { token: string } }>('/v1/evidence/:token', async (request, reply) => {
    const evidence = await context.withoutTenant((tx) =>
      resolvePublicEvidence(tx, request.params.token),
    );

    if (!evidence) {
      throw new NxError('NX-4041', { requestId: request.id });
    }

    return reply.send({
      content_hash: evidence.contentHash,
      sealed_at: evidence.signedAt.toISOString(),
      expires_at: evidence.expiresAt?.toISOString() ?? null,
      // First, because it changes what everything below it means.
      sandbox: evidence.sandbox,
      ...(evidence.sandbox
        ? {
            sandbox_note_ar: 'هذا ختم من بيئة الاختبار ولا يثبت شيئاً عن أي جهة.',
            sandbox_note_en: 'This seal was made in a sandbox and proves nothing about anybody.',
          }
        : {}),
      // Said plainly on the page, so nobody expects to find the subject here.
      note_ar: 'هذه الصفحة تثبت ختم المستند ووقته فقط، ولا تعرض أي بيانات شخصية.',
      note_en: 'This page confirms the document seal and its time only. It shows no personal data.',
    });
  });
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

/**
 * Pulls identifiers out of the subject when the caller did not name them.
 *
 * Deliberately conservative: it recognises the keys the seeded products use and nothing
 * else. Guessing more widely would resolve the wrong entity, and a wrong merge is far
 * harder to undo than a 400.
 */
/**
 * Reads whatever identifiers the subject happens to carry.
 *
 * Shared with the onboarding routes, which take the same applicant record: one reading of
 * a subject rather than two that could disagree about what counts as an identifier.
 */
export function inferIdentifiers(subject: Record<string, unknown>): IdentifierInput[] {
  const identifiers: IdentifierInput[] = [];
  const add = (idType: IdentifierInput['idType'], value: unknown): void => {
    if (typeof value === 'string' && value.length > 0) {
      identifiers.push({ idType, value });
    }
  };

  add('UNN', subject['unn']);
  add('CR', subject['cr_number']);
  add('IBAN', subject['iban']);

  const identifier = subject['identifier'];
  if (identifier && typeof identifier === 'object') {
    const record = identifier as Record<string, unknown>;
    const type = record['type'];
    if (
      typeof type === 'string' &&
      IDENTIFIER_TYPES.includes(type as (typeof IDENTIFIER_TYPES)[number])
    ) {
      add(type as IdentifierInput['idType'], record['value']);
    }
  }

  return identifiers;
}
