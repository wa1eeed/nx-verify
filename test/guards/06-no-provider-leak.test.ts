import { describe, expect, it } from 'vitest';
import {
  assertNoProviderLeak,
  describeProviderInput,
  redactForLog,
  toPublicResults,
  toPublicStepResult,
  NxError,
  type InternalStepRecord,
} from '../../packages/core/src/index.js';
import {
  InMemorySecretStore,
  ProviderRegistry,
  StubProvider,
} from '../../packages/providers/src/index.js';
import type { ResolvedCredential } from '../../packages/providers/src/types.js';

/**
 * Guard 06: no provider name appears in any public response.
 *
 * Rule 5 and ADR-006. The exposed provenance field is `authority`, the official body.
 * `source` is internal. A caller who can name our provider can go around us, and a
 * provider who knows we expose their name has leverage in every negotiation after that.
 *
 * The provider here is registered under a distinctive name on purpose. Testing against
 * the word "stub" would pass by accident the day a real provider is named something that
 * happens to appear in a payload.
 */

const PROVIDER_NAME = 'wathq-example-connector';
const SECRET = 'super-secret-api-key-value';

function credential(): ResolvedCredential {
  return {
    ref: 'kms://tenants/test/providers/example',
    mode: 'BYOC',
    material: { apiKey: SECRET, clientSecret: SECRET },
  };
}

function registry(): ProviderRegistry {
  return new ProviderRegistry().register(new StubProvider({ name: PROVIDER_NAME }));
}

describe('guard 06: no provider name in a public response', () => {
  it('keeps the provider out of a successful step result but keeps the authority', async () => {
    const provider = registry().get(PROVIDER_NAME);
    const result = await provider.execute({
      endpoint: 'business_verification',
      input: { identifications: '7001272184' },
      credential: credential(),
    });

    const internal: InternalStepRecord = {
      stepKey: 'cr_full',
      status: 'OK',
      provider: provider.name,
      endpoint: 'business_verification',
      authority: result.authority,
    };

    const publicResult = toPublicStepResult(internal);
    expect(publicResult.authority).toBe('Commercial Registry');
    expect(() => assertNoProviderLeak(publicResult, [PROVIDER_NAME])).not.toThrow();
  });

  it('is not a vacuous check: the internal record does carry the provider', () => {
    const internal: InternalStepRecord = {
      stepKey: 'cr_full',
      status: 'OK',
      provider: PROVIDER_NAME,
      endpoint: 'business_verification',
      authority: 'Commercial Registry',
    };
    expect(() => assertNoProviderLeak(internal, [PROVIDER_NAME])).toThrow(NxError);
  });

  it('keeps the provider out of a whole results map, including failed steps', async () => {
    const provider = registry().get(PROVIDER_NAME);
    const failure = await provider.execute({
      endpoint: 'business_verification',
      input: { identifications: '7000000002' },
      credential: credential(),
    });

    const steps: InternalStepRecord[] = [
      {
        stepKey: 'cr_full',
        status: 'ERROR',
        provider: provider.name,
        endpoint: 'business_verification',
        authority: failure.authority,
        errorCode: failure.errorCode,
      },
      {
        stepKey: 'manager_auth',
        status: 'SKIPPED',
        provider: provider.name,
        endpoint: 'manager_permissions',
        authority: null,
        skippedBecause: 'depends_on:cr_full',
      },
    ];

    const results = toPublicResults(steps);
    expect(results['manager_auth']?.reason).toBe('depends_on:cr_full');
    expect(() => assertNoProviderLeak(results, [PROVIDER_NAME])).not.toThrow();
  });

  it('keeps the provider and the endpoint out of a public error payload', () => {
    const error = new NxError('NX-5002', {
      detail: `${PROVIDER_NAME} returned 503 from business_verification`,
      requestId: 'req_1',
    });

    // The detail is internal and stays on `message`. The public projection is built from
    // the catalog, so nothing a caller sees can carry what the detail said.
    const publicPayload = error.toPublicJson();
    expect(() => assertNoProviderLeak(publicPayload, [PROVIDER_NAME])).not.toThrow();
    expect(publicPayload.retryable).toBe(true);
    expect(publicPayload.request_id).toBe('req_1');
  });

  it('strips every registered provider name without a hardcoded list', () => {
    const names = registry().names();
    expect(names).toContain(PROVIDER_NAME);
    expect(() => assertNoProviderLeak({ note: `served by ${PROVIDER_NAME}` }, names)).toThrow(
      NxError,
    );
  });

  it('keeps credentials out of anything written to a log', () => {
    const logLine = redactForLog({
      step: 'cr_full',
      credential: credential(),
      request: { apiKey: SECRET, Authorization: `Bearer ${SECRET}` },
    });

    const serialized = JSON.stringify(logLine);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).toContain('cr_full');
  });

  it('logs the shape of a provider request and never its values', () => {
    // The keys of a provider request come from a product's input_binding and are named
    // by the provider, so a denylist can never cover them. This one carries a national
    // id under the name `identifications`.
    const input = { identifications: '7001272184', type: 'ADDRESS', page: 1 };
    const described = describeProviderInput(input);

    expect(described).toEqual({ identifications: 'string', type: 'string', page: 'number' });
    expect(JSON.stringify(described)).not.toContain('7001272184');
  });

  it('redacts an identifier that arrives under a key a denylist did anticipate', () => {
    const serialized = JSON.stringify(
      redactForLog({ nationalId: '1098765432', iban: 'SA0380000000608010167519' }),
    );
    expect(serialized).not.toContain('1098765432');
    expect(serialized).not.toContain('SA0380000000608010167519');
  });

  it('never returns credential material from the secret store through a provider result', async () => {
    const secrets = new InMemorySecretStore({
      'kms://tenants/test/providers/example': { apiKey: SECRET },
    });
    const material = await secrets.fetch('kms://tenants/test/providers/example');
    const provider = registry().get(PROVIDER_NAME);

    const result = await provider.execute({
      endpoint: 'business_verification',
      input: { identifications: '7001272184' },
      credential: { ref: 'kms://tenants/test/providers/example', mode: 'MANAGED', material },
    });

    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
