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

function recorded(answers: { status?: number; body?: unknown; tokenStatus?: number }[] = [{}]): {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  calls: Call[];
} {
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

    // As the specification answers: both kinds of income under insights.
    const income = build([
      {
        body: {
          status: 'OK',
          insights: {
            salary: {
              currency: 'SAR',
              total: {
                amount: 222_000,
                average_monthly_amount: 18_500,
                average_monthly_count: 1,
                count: 12,
                first_date_time: '2025-09-01T00:00:00Z',
                last_date_time: '2026-08-01T00:00:00Z',
                maximum_monthly_amount: { month: 3, year: 2026, amount: 21_000 },
                minimum_monthly_amount: { month: 9, year: 2025, amount: 17_000 },
              },
              monthly_totals: [
                { month: 8, year: 2026, amount: 18_500, count: 1, is_month_complete: true },
              ],
              transactions: [
                {
                  account_id: 'a1',
                  transaction_id: 't1',
                  transaction_information: 'SALARY',
                  booking_date_time: '2026-08-01T00:00:00Z',
                  amount: 18_500,
                  income_source: { type: 'EMPLOYMENT', name: 'شركة المثال' },
                },
              ],
              income_factors: { delta_min_max: 1.24, average_monthly_income_change: 0.5 },
            },
            non_salary: {
              currency: 'SAR',
              total: { amount: 4_000, count: 2, average_monthly_amount: 333 },
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
    expect(verified.data?.['income_total']).toBe(222_000);
    expect(verified.data?.['income_highest_month']).toBe('2026-03');
    expect(verified.data?.['income_lowest_amount']).toBe(17_000);
    expect(verified.data?.['income_months']).toEqual([
      { year: 2026, month: 8, amount: 18_500, count: 1, complete: true },
    ]);
    expect(verified.data?.['income_sources']).toEqual(['EMPLOYMENT · شركة المثال']);
    expect(verified.data?.['other_income_total']).toBe(4_000);
    // The account's own references are never carried into the bag.
    expect(JSON.stringify(verified.data)).not.toContain('t1');
    expect(verified.authority).toBe('Bank Statements');

    // An older answer with the salary at the top is still read.
    const older = build([
      {
        body: {
          status: 'OK',
          salary: { currency: 'SAR', total: { average_monthly_amount: 9_000 } },
        },
      },
    ]);
    const olderAnswer = await older.provider.execute({
      endpoint: 'income_verification',
      input: { entity_id: 'e1' },
      credential: CREDENTIAL,
    });
    expect(olderAnswer.data?.['average_monthly_income']).toBe(9_000);
  });

  it('reads a partial name match and the bank of an account ownership answer', async () => {
    const { provider } = build([
      {
        body: {
          status: 'OK',
          verifications: {
            account_ownership_verified: false,
            matching: { type: 'PARTIAL', score: 0.72 },
            bank_details: {
              bank_name: { en: 'AlBilad Bank', ar: 'بنك البلاد' },
              bank_identifiers: [
                { type: 'SWIFT_CODE', value: 'ALBISARI' },
                { type: 'BANK_CODE', value: '15' },
              ],
            },
            account_status: 'ACTIVE',
            account_holder_name: 'NA****AL****',
            account_currency: 'SAR',
            verification_method: 'CONFIRMATION_OF_PAYEE_SERVICE',
          },
        },
      },
    ]);
    const result = await provider.execute({
      endpoint: 'bank_account_ownership',
      input: { iban: 'SA1' },
      credential: CREDENTIAL,
    });
    expect(result.data).toMatchObject({
      match_result: 'PARTIAL',
      match_score: 0.72,
      bank_name: 'بنك البلاد',
      bank_swift: 'ALBISARI',
      bank_code: '15',
      account_currency: 'SAR',
    });
  });
});
