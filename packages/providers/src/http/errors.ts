import type { ProviderErrorCode } from '../types.js';

/**
 * Turning an upstream failure into one of our six normalised reasons.
 *
 * The domain layer decides what to do about a failure, and it can only do that if
 * failures arrive in a known set. An upstream status code, a provider specific error body
 * and a socket error all end here, and nothing past this file knows which it was.
 */

export interface NormalisedFailure {
  errorCode: ProviderErrorCode;
  retryable: boolean;
}

export function failureForStatus(status: number): NormalisedFailure {
  if (status === 401 || status === 403) {
    // Retrying a rejected credential burns the rate limit and changes nothing.
    return { errorCode: 'AUTH', retryable: false };
  }
  if (status === 429) {
    return { errorCode: 'RATE_LIMIT', retryable: true };
  }
  if (status === 408 || status === 504) {
    return { errorCode: 'TIMEOUT', retryable: true };
  }
  if (status >= 500) {
    return { errorCode: 'UPSTREAM', retryable: true };
  }
  if (status === 422 || status === 400) {
    // The request was wrong. Sending it again unchanged will be wrong again.
    return { errorCode: 'MALFORMED', retryable: false };
  }
  return { errorCode: 'UPSTREAM', retryable: false };
}

export function failureForThrown(error: unknown): NormalisedFailure {
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return { errorCode: 'TIMEOUT', retryable: true };
  }
  return { errorCode: 'NETWORK', retryable: true };
}

/**
 * Whether a 404 means "this subject does not exist" or "this endpoint does not exist".
 *
 * The distinction decides whether the customer is billed. A subject that is genuinely
 * absent is a real answer and is billed at the negative rate; a wrong path is our bug and
 * is billed at nothing. Guessing here costs money in one direction or trust in the other.
 */
export function isSubjectAbsent(status: number, body: unknown): boolean {
  if (status !== 404) {
    return false;
  }
  if (body === null || typeof body !== 'object') {
    return true;
  }
  const record = body as Record<string, unknown>;
  const code = String(record['code'] ?? record['errorCode'] ?? '').toUpperCase();
  return code !== 'UNKNOWN_ENDPOINT' && code !== 'NOT_IMPLEMENTED';
}
