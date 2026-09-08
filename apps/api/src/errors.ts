import { NxError, assertNoProviderLeak, scrubText } from '@nx-verify/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ProviderRegistry } from '@nx-verify/providers';

/**
 * The single error path.
 *
 * Every error leaves through here, and every response is built from our own catalog
 * rather than from the thrown message. That is what keeps rules 4, 5 and 10 true on the
 * failure path, which is where leaks actually happen: the success path is designed, the
 * error path is improvised.
 *
 * The leak assertion runs in the response itself, not only in tests, because a test only
 * protects the paths it covers.
 */

export interface ErrorBody {
  error: {
    code: string;
    message_ar: string;
    message_en: string;
    retryable: boolean;
    request_id: string | undefined;
  };
}

export function registerErrorHandler(app: FastifyInstance, registry: ProviderRegistry): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    if (error instanceof NxError) {
      const body: ErrorBody = { error: { ...error.toPublicJson(), request_id: requestId } };
      assertNoProviderLeak(body, registry.names());
      // The detail carried on the message is internal and stays in the log.
      request.log.warn({ code: error.code, detail: error.message }, 'request failed');
      return reply.status(error.status).send(body);
    }

    if (isValidationError(error)) {
      const body: ErrorBody = {
        error: {
          code: 'NX-4001',
          message_ar: 'المدخلات غير صالحة',
          message_en: 'Invalid input',
          retryable: false,
          request_id: requestId,
        },
      };
      return reply.status(400).send(body);
    }

    if (isRateLimitError(error)) {
      const body: ErrorBody = {
        error: {
          code: 'NX-4029',
          message_ar: 'تجاوزت الحد المسموح، أعد المحاولة لاحقاً',
          message_en: 'Rate limit exceeded, retry later',
          retryable: true,
          request_id: requestId,
        },
      };
      return reply.status(429).send(body);
    }

    // Anything unrecognised becomes a generic internal error. The original never reaches
    // the caller, because we cannot know what a library put in its message.
    const message = error instanceof Error ? error.message : String(error);
    request.log.error({ err: scrubText(message, registry.names()) }, 'unhandled error');

    return reply.status(500).send({
      error: {
        code: 'NX-5001',
        message_ar: 'خطأ داخلي',
        message_en: 'Internal error',
        retryable: false,
        request_id: requestId,
      },
    } satisfies ErrorBody);
  });
}

function isValidationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'ZodError'
  );
}

function isRateLimitError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode?: unknown }).statusCode === 429
  );
}
