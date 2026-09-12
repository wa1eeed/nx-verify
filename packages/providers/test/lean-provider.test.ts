import { describe, expect, it } from 'vitest';
import { LeanProvider } from '../src/lean/lean-provider.js';
import { TokenCache } from '../src/lean/token.js';
import type { ResolvedCredential } from '../src/types.js';

/**
 * Unit 39 acceptance: an open banking provider behind the same interface as every other.
 *
 * The adapter is exercised against recorded upstream responses, so the whole of it runs
 * here and pointing it at a sandbox is configuration rather than code. What the tests are
 * really about is the three ways this provider differs from the registry one: it mints
 * tokens, it speaks its own status vocabulary, and it must not leak its own name.
 */

const CREDENTIAL: ResolvedCredential = {
  ref: 'kms://tenants/acme/openbanking',
  mode: 'BYOC',
  material: { clientId: 'app-id', clientSecret: 'the-secret', scope: 'api' },
};

const ACCOUNT_OK = {
  status: 'OK',
  results_id: '9f1c2b44-7e10-4a2f-9b0c-2f3a51d8e001',
  verifications: {
    account_ownership_verified: true,
    account_holder_name: 'مؤسسة نماء للمقاولات',
    account_status: 'ACTIVE',
    account_currency: 'SAR',
    verification_method: 'CONFIRMATION_OF_PAYEE_SERVICE',
    matching: { type: 'NAME', score: 0.97 },
  },
};

interface Call {
  url: string;
  init: RequestInit;
}

function recorded(
  answers: { status?: number; body?: unknown; tokenStatus?: number }[] = [{}],
): { fetch: (url: string, init: RequestInit) => Promise<Response>; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;

  const fetchLike = (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });

    if (url.includes('/oauth2/token')) {
      const answer = answers[Math.min(index, answers.length - 1)] ?? {};
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3599 }), {
          status: answer.tokenStatus ?? 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    const answer = answers[Math.min(index, answers.length - 1)] ?? {};
    index += 1;
    return Promise.resolve(
      new Response(JSON.stringify(answer.body ?? ACCOUNT_OK), {
        status: answer.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return { fetch: fetchLike, calls };
}

function build(answers?: Parameters<typeof recorded>[0]): {
  provider: LeanProvider;
  calls: Call[];
} {
  const { fetch, calls } = recorded(answers);
  const provider = new LeanProvider({
    name: 'openbanking-example',
    baseUrl: 'https://sandbox.example.com',
    authUrl: 'https://auth.sandbox.example.com/oauth2/token',
    fetch,
    tokens: new TokenCache({ fetch }),
  });
  return { provider, calls };
}

describe('the open banking adapter', () => {
  it('verifies account ownership and returns our field names, not theirs', async () => {
    const { provider } = build();
    const result = await provider.execute({
      endpoint: 'bank_account_ownership',
      input: {
        iban: 'SA4420000001234567891234',
        full_name: 'مؤسسة نماء للمقاولات',
        registration_id: '1010101010',
      },
      credential: CREDENTIAL,
    });

    expect(result.outcome).toBe('OK');
    expect(result.data).toEqual({
      match_result: 'MATCH',
      account_holder_name: 'مؤسسة نماء للمقاولات',
      account_status: 'ACTIVE',
      account_currency: 'SAR',
      match_score: 0.97,
      verification_method: 'CONFIRMATION_OF_PAYEE_SERVICE',
    });
    // Their vocabulary stops at this file: nothing downstream sees account_ownership_verified.
    expect(JSON.stringify(result.data)).not.toContain('account_ownership_verified');
  });

  it('names the authority and never itself', async () => {
    const { provider } = build();
    const result = await provider.execute({
      endpoint: 'bank_account_ownership',
      input: { iban: 'SA4420000001234567891234' },
      credential: CREDENTIAL,
    });

    // Rule 5: the customer sees who confirmed it, not who carried the question.
    expect(result.authority).toBe('Confirmation of Payee');
    expect(JSON.stringify(result)).not.toContain('openbanking-example');
  });

  it('treats a refused ownership check as an answer rather than a failure', async () => {
    const { provider } = build([
      {
        body: {
          status: 'OK',
          verifications: { account_ownership_verified: false, account_holder_name: null },
        },
      },
    ]);

    const result = await provider.execute({
      endpoint: 'bank_account_ownership',
      input: { iban: 'SA4420000001234567891234', full_name: 'شخص آخر' },
      credential: CREDENTIAL,
    });

    // The account exists and the name does not match. Billing it as an error would hide
    // the one result the customer most needs to see.
    expect(result.outcome).toBe('OK');
    expect(result.data?.['match_result']).toBe('NO_MATCH');
  });

  it('mints one token and reuses it across calls', async () => {
    const { provider, calls } = build();
    await provider.execute({
      endpoint: 'bank_account_ownership',
      input: { iban: 'SA1' },
      credential: CREDENTIAL,
    });
    await provider.execute({
      endpoint: 'bank_account_ownership',
      input: { iban: 'SA2' },
      credential: CREDENTIAL,
    });

    const tokenCalls = calls.filter((call) => call.url.includes('/oauth2/token'));
    expect(tokenCalls).toHaveLength(1);
    // And the secret goes to the identity service only, never to the API host.
    for (const call of calls.filter((entry) => !entry.url.includes('/oauth2/token'))) {
      expect(String(call.init.body ?? '')).not.toContain('the-secret');
      expect(JSON.stringify(call.init.headers)).not.toContain('the-secret');
    }
  });

  it('mints a fresh token once when the upstream rejects the one it had', async () => {
    const { provider, calls } = build([{ status: 401 }, { status: 200 }]);
    const result = await provider.execute({
      endpoint: 'bank_account_ownership',
      input: { iban: 'SA1' },
      credential: CREDENTIAL,
    });

    expect(result.outcome).toBe('OK');
    expect(calls.filter((call) => call.url.includes('/oauth2/token'))).toHaveLength(2);
  });

  it('maps the upstream failures onto the small set the domain layer knows', async () => {
    for (const [status, code, retryable] of [
      [429, 'RATE_LIMIT', true],
      [503, 'UPSTREAM', true],
      [403, 'AUTH', false],
    ] as const) {
      const { provider } = build([{ status }]);
      const result = await provider.execute({
        endpoint: 'bank_account_ownership',
        input: { iban: 'SA1' },
        credential: CREDENTIAL,
      });
      expect(result.errorCode).toBe(code);
      expect(result.retryable).toBe(retryable);
      // A failure carries no authority, because nothing was established.
      expect(result.authority).toBeNull();
    }
  });

  it('refuses an endpoint it does not serve rather than guessing', async () => {
    const { provider } = build();
    const result = await provider.execute({
      endpoint: 'commercial_registry',
      input: {},
      credential: CREDENTIAL,
    });
    expect(result.errorCode).toBe('UNSUPPORTED_ENDPOINT');
  });

  it('checks health by minting a token, which verifies nobody and charges nothing', async () => {
    const { provider, calls } = build();
    const health = await provider.healthCheck(CREDENTIAL);
    expect(health.status).toBe('healthy');
    expect(calls.every((call) => call.url.includes('/oauth2/token'))).toBe(true);

    const refused = build([{ tokenStatus: 401 }]);
    expect((await refused.provider.healthCheck(CREDENTIAL)).status).toBe('down');
  });

  it('maps a name match and an income summary into our names too', async () => {
    const name = build([
      {
        body: {
          status: 'OK',
          data: {
            full_name_provided: 'محمد أحمد',
            full_name_retrieved: 'محمد أحمد',
            match_type: 'PERFECT_MATCH',
            confidence: 1,
          },
        },
      },
    ]);
    const matched = await name.provider.execute({
      endpoint: 'name_match',
      input: { entity_id: 'e1', full_name: 'محمد أحمد' },
      credential: CREDENTIAL,
    });
    expect(matched.data?.['match_result']).toBe('PERFECT_MATCH');
    expect(matched.data?.['match_confidence']).toBe(1);

    const income = build([
      {
        body: {
          status: 'OK',
          salary: {
            currency: 'SAR',
            total: {
              average_monthly_amount: 18_500,
              count: 12,
              first_date_time: '2025-09-01T00:00:00Z',
              last_date_time: '2026-08-01T00:00:00Z',
            },
          },
        },
      },
    ]);
    const verified = await income.provider.execute({
      endpoint: 'income_verification',
      input: { entity_id: 'e1' },
      credential: CREDENTIAL,
    });
    expect(verified.data?.['average_monthly_income']).toBe(18_500);
    expect(verified.authority).toBe('Bank Statements');
  });
});
