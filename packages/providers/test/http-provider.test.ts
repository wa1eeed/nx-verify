import { describe, expect, it } from 'vitest';
import { HttpVerificationProvider } from '../src/http/http-provider.js';
import { mapResponse, DEFAULT_ENDPOINTS } from '../src/http/response-mapping.js';
import { failureForStatus, isSubjectAbsent } from '../src/http/errors.js';
import { recordedFetch, type RecordedCall } from './fixtures/recorded.js';
import type { ResolvedCredential } from '../src/types.js';

/**
 * The real provider adapter, against recorded upstream responses.
 *
 * No account and no network. Every branch a live integration meets is exercised here,
 * which is what lets unit 9 be finished before a contract exists rather than after.
 */

const CREDENTIAL: ResolvedCredential = {
  ref: 'kms://tenants/test/providers/real',
  mode: 'MANAGED',
  material: { apiKey: 'recorded-key' },
};

function provider(calls: RecordedCall[] = []): HttpVerificationProvider {
  const { fetch } = recordedFetch(calls);
  return new HttpVerificationProvider({
    name: 'recorded-provider',
    baseUrl: 'https://upstream.example',
    fetch,
    retryDelayMs: 1,
  });
}

describe('the http provider normalises what a real upstream sends', () => {
  it('unwraps the envelope, renames and flattens', async () => {
    const result = await provider().execute({
      endpoint: 'business_verification',
      input: { identifications: '7001272184' },
      credential: CREDENTIAL,
    });

    expect(result.outcome).toBe('OK');
    expect(result.authority).toBe('Commercial Registry');
    // Their names and their nesting stop at the adapter. These are the names our
    // step_field_map rows address.
    expect(result.data).toMatchObject({
      unified_number: '7001272184',
      cr_status: 'ACTIVE',
      company_name: 'شركة المثال للتجارة',
      capital: 500000,
      // The nested address arrives flat, under the same names the stub emits, so the
      // product definition cannot tell which provider answered.
      city: 'الرياض',
      building_number: '2743',
    });
    expect(result.data?.['requestId']).toBeUndefined();
  });

  it('reads what the call cost us when the provider reports it', async () => {
    const result = await provider().execute({
      endpoint: 'business_verification',
      input: { identifications: '7001272184' },
      credential: CREDENTIAL,
    });
    expect(result.providerCost).toBe(3.25);
  });

  it('flattens an array of managers into entries the field map can walk', async () => {
    const result = await provider().execute({
      endpoint: 'articles_of_association',
      input: { unified_number: '7001272184' },
      credential: CREDENTIAL,
    });

    const managers = result.data?.['managers'] as Record<string, unknown>[];
    expect(managers[0]).toMatchObject({
      id: '1098765432',
      id_type: 'NATIONAL_ID',
      signing_authority: 'SOLE',
    });
  });

  it('separates an absent subject from a broken call', async () => {
    const absent = await provider().execute({
      endpoint: 'business_verification',
      input: { identifications: '7000000000' },
      credential: CREDENTIAL,
    });

    // Billed at the negative rate, because the authority answered.
    expect(absent.outcome).toBe('NOT_FOUND');
    expect(absent.errorCode).toBeUndefined();
    expect(absent.authority).toBe('Commercial Registry');
  });

  it('treats a two hundred with an empty envelope as an absent subject', async () => {
    const empty = await provider().execute({
      endpoint: 'business_verification',
      input: { identifications: '7000000004' },
      credential: CREDENTIAL,
    });
    // The call reached the authority and cost us, so it is not an error.
    expect(empty.outcome).toBe('NOT_FOUND');
  });

  it('never retries a rejected credential', async () => {
    const calls: RecordedCall[] = [];
    const result = await provider(calls).execute({
      endpoint: 'business_verification',
      input: { identifications: '7000000002' },
      credential: CREDENTIAL,
    });

    expect(result.errorCode).toBe('AUTH');
    expect(result.retryable).toBe(false);
    // Retrying burns the rate limit and changes nothing.
    expect(calls).toHaveLength(1);
  });

  it('retries a transient failure and gives up rather than looping', async () => {
    const calls: RecordedCall[] = [];
    const result = await provider(calls).execute({
      endpoint: 'business_verification',
      input: { identifications: '7000000006' },
      credential: CREDENTIAL,
    });

    expect(result.errorCode).toBe('UPSTREAM');
    expect(calls).toHaveLength(3);
  });

  it('marks a rate limit retryable', async () => {
    const result = await provider().execute({
      endpoint: 'business_verification',
      input: { identifications: '7000000005' },
      credential: CREDENTIAL,
    });
    expect(result.errorCode).toBe('RATE_LIMIT');
    expect(result.retryable).toBe(true);
  });

  it('reports a network failure as retryable without inventing data', async () => {
    const failing = new HttpVerificationProvider({
      name: 'recorded-provider',
      baseUrl: 'https://upstream.example',
      maxAttempts: 1,
      fetch: () => Promise.reject(new Error('socket hang up')),
    });

    const result = await failing.execute({
      endpoint: 'business_verification',
      input: { identifications: '7001272184' },
      credential: CREDENTIAL,
    });

    expect(result.errorCode).toBe('NETWORK');
    expect(result.data).toBeNull();
  });

  it('sends the credential as a header and never in the path or body', async () => {
    const calls: RecordedCall[] = [];
    await provider(calls).execute({
      endpoint: 'iban_ownership',
      input: { iban: 'SA0380000000608010167519', identifier: '1010478213' },
      credential: CREDENTIAL,
      idempotencyKey: 'idem-1',
    });

    const call = calls[0];
    expect(call?.method).toBe('POST');
    expect(call?.headers['apikey']).toBe('recorded-key');
    expect(call?.url).not.toContain('recorded-key');
    expect(call?.body).not.toContain('recorded-key');
    // Passed upstream so our retry is not a second charge to us either.
    expect(call?.headers['idempotency-key']).toBe('idem-1');
  });

  it('puts path parameters in the path and the rest in the body', async () => {
    const calls: RecordedCall[] = [];
    await provider(calls).execute({
      endpoint: 'manager_permissions',
      input: { unified_number: '7001272184', manager_id: '1098765432' },
      credential: CREDENTIAL,
    });

    expect(calls[0]?.url).toBe('/v1/aoa/7001272184/managers/1098765432');
    expect(calls[0]?.method).toBe('GET');
  });

  it('refuses an endpoint it does not map', async () => {
    const result = await provider().execute({
      endpoint: 'not_mapped',
      input: {},
      credential: CREDENTIAL,
    });
    expect(result.errorCode).toBe('UNSUPPORTED_ENDPOINT');
  });

  it('reports health without a verification', async () => {
    const health = await provider().healthCheck(CREDENTIAL);
    expect(health.status).toBe('healthy');
  });
});

describe('the failure classifier', () => {
  it('maps statuses onto our six reasons', () => {
    expect(failureForStatus(401)).toEqual({ errorCode: 'AUTH', retryable: false });
    expect(failureForStatus(429)).toEqual({ errorCode: 'RATE_LIMIT', retryable: true });
    expect(failureForStatus(500)).toEqual({ errorCode: 'UPSTREAM', retryable: true });
    expect(failureForStatus(400)).toEqual({ errorCode: 'MALFORMED', retryable: false });
  });

  it('tells an absent subject from a wrong path', () => {
    // The distinction decides whether the customer is billed.
    expect(isSubjectAbsent(404, { code: 'RECORD_NOT_FOUND' })).toBe(true);
    expect(isSubjectAbsent(404, { code: 'UNKNOWN_ENDPOINT' })).toBe(false);
    expect(isSubjectAbsent(500, {})).toBe(false);
  });

  it('returns null rather than an empty object when there is nothing to map', () => {
    const mapping = DEFAULT_ENDPOINTS['business_verification'];
    expect(mapping).toBeDefined();
    if (!mapping) {
      return;
    }
    expect(mapResponse(mapping, { data: null })).toBeNull();
    expect(mapResponse(mapping, {})).toBeNull();
  });
});
