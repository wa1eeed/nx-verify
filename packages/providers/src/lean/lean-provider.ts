import { TokenCache, type FetchLike } from './token.js';
import { LEAN_VERIFICATION_ENDPOINTS } from './verification-endpoints.js';
import type {
  ProviderErrorCode,
  ProviderHealth,
  ProviderRequest,
  ProviderResult,
  ResolvedCredential,
  VerificationProvider,
} from '../types.js';

/**
 * An open banking provider, behind the same interface as every other.
 *
 * Three things make this adapter different from the registry adapter, and all three stop
 * inside this file. It authenticates with OAuth client credentials rather than a static
 * key, so it holds a token cache. Its endpoints are POST with JSON bodies built from our
 * input rather than paths with identifiers in them. And it answers with its own status
 * vocabulary, which is mapped to the three outcomes the domain layer knows.
 *
 * What does not stop here is equally important: the authority. A customer reading a bank
 * account verification sees the bank and the payment scheme that confirmed it, never the
 * name of the company that carried the request (rule 5). The name of this class is
 * internal, and the string in `name` must never reach a caller.
 */

export interface LeanEndpointMapping {
  path: string;
  authority: string;
  /** Builds the upstream body from the flat input a step_field_map binding produced. */
  body: (input: Readonly<Record<string, unknown>>) => Record<string, unknown>;
  /**
   * Turns the upstream payload into the flat bag normalisation expects. The request's own
   * input is passed too, because some answers only make sense beside the question: which
   * certificate was asked about, which of two registry numbers is the one we sent.
   */
  map: (
    payload: Record<string, unknown>,
    input: Readonly<Record<string, unknown>>,
  ) => Record<string, unknown>;
  /** Reads the upstream's own status vocabulary. */
  outcome?: (payload: Record<string, unknown>) => 'OK' | 'NOT_FOUND' | 'ERROR' | 'AWAITING';
  /**
   * The authority, when it depends on the answer: an account confirmed through the
   * national payments rail and one confirmed by the bank directly are two different
   * authorities, and a subscriber is owed the right one.
   */
  authorityFor?: (payload: Record<string, unknown>) => string;
  /** Our error code for an answer the outcome reads as ERROR. */
  failureCode?: (payload: Record<string, unknown>) => ProviderErrorCode;
  /**
   * What the provider will name when it calls back, read from the payload it answered
   * with. Required for an endpoint whose outcome can be AWAITING: without it there is
   * nothing to recognise the callback by and the run would wait for ever.
   */
  correlation?: (
    payload: Record<string, unknown>,
    input: Readonly<Record<string, unknown>>,
  ) => string | null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * What an answer did not say is left out rather than recorded as empty, as the verification
 * products do (compact in ./verification-endpoints): a missing value is not a fact.
 */
function withoutEmpty(bag: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(bag).filter(
      ([, value]) =>
        value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0),
    ),
  );
}

/**
 * The endpoints, as data.
 *
 * Adding one is a table entry. The bodies name the provider's fields and the maps name
 * ours, and the two vocabularies meet here and nowhere else.
 */
export const LEAN_ENDPOINTS: Readonly<Record<string, LeanEndpointMapping>> = {
  // The verification products: registry, managers, address, freelance, IBAN, property.
  ...LEAN_VERIFICATION_ENDPOINTS,
  bank_account_ownership: {
    path: '/verifications/v1/accounts',
    // The scheme that confirms a payee, not the company that carried the question.
    authority: 'Confirmation of Payee',
    body: (input) => ({
      country_code: String(input['country_code'] ?? 'SA'),
      type: String(input['subject_type'] ?? 'BUSINESS'),
      account_details: {
        type: 'IBAN',
        value: String(input['iban'] ?? ''),
      },
      identifications: [
        ...(input['full_name'] ? [{ type: 'FULL_NAME', value: String(input['full_name']) }] : []),
        ...(input['registration_id']
          ? [{ type: 'REGISTRATION_ID', value: String(input['registration_id']) }]
          : []),
        ...(input['national_id']
          ? [{ type: 'NATIONAL_ID', value: String(input['national_id']) }]
          : []),
      ],
    }),
    map: (payload) => {
      const verifications = asRecord(payload['verifications']);
      const matching = asRecord(verifications['matching']);
      const bank = asRecord(verifications['bank_details']);
      const bankName = asRecord(bank['bank_name']);
      const identifiers = Array.isArray(bank['bank_identifiers'])
        ? (bank['bank_identifiers'] as unknown[]).map(asRecord)
        : [];
      const bankIdentifier = (...types: string[]): unknown =>
        identifiers.find((entry) => types.includes(String(entry['type'])))?.['value'] ?? null;
      return withoutEmpty({
        // Our names, which step_field_map rows reference, so the product definition does
        // not move when the provider behind the step changes.
        match_result:
          verifications['account_ownership_verified'] === true
            ? 'MATCH'
            : matching['type'] === 'PARTIAL'
              ? 'PARTIAL'
              : 'NO_MATCH',
        account_holder_name: verifications['account_holder_name'] ?? null,
        account_status: verifications['account_status'] ?? null,
        account_currency: verifications['account_currency'] ?? null,
        match_score: matching['score'] ?? null,
        verification_method: verifications['verification_method'] ?? null,
        bank_name: bankName['ar'] ?? bankName['en'] ?? null,
        bank_swift: bankIdentifier('SWIFT_CODE', 'BIC'),
        bank_code: bankIdentifier('BANK_CODE'),
        bank_clearing_id: bankIdentifier('CLEARING_ID'),
      });
    },
    outcome: (payload) => {
      if (payload['status'] === 'OK') {
        return 'OK';
      }
      // A refused verification is an answer, not a failure: the account exists and the
      // name does not match. Treating it as an error would bill it as one and hide it.
      return asRecord(payload['verifications'])['account_ownership_verified'] === false
        ? 'OK'
        : 'NOT_FOUND';
    },
  },

  name_match: {
    path: '/insights/v1/name-verification',
    authority: 'Account Holder Records',
    body: (input) => ({
      entity_id: String(input['entity_id'] ?? ''),
      full_name: String(input['full_name'] ?? ''),
    }),
    map: (payload) => {
      const data = asRecord(payload['data']);
      return withoutEmpty({
        match_result: data['match_type'] ?? null,
        name_provided: data['full_name_provided'] ?? null,
        name_retrieved: data['full_name_retrieved'] ?? null,
        match_confidence: data['confidence'] ?? null,
      });
    },
    outcome: (payload) => (payload['status'] === 'OK' ? 'OK' : 'NOT_FOUND'),
  },

  income_verification: {
    path: '/insights/v2/income',
    authority: 'Bank Statements',
    body: (input) => ({
      entity_id: String(input['entity_id'] ?? ''),
      ...(input['start_date'] ? { start_date: String(input['start_date']) } : {}),
      income_type: String(input['income_type'] ?? 'ALL'),
    }),
    map: (payload) => {
      // The specification nests both kinds of income under insights; an answer that put the
      // salary at the top is read too, so neither shape records nothing.
      const insights = asRecord(payload['insights']);
      const salary = asRecord(insights['salary'] ?? payload['salary']);
      const other = asRecord(insights['non_salary'] ?? payload['non_salary']);
      const total = asRecord(salary['total']);
      const otherTotal = asRecord(other['total']);
      const factors = asRecord(salary['income_factors']);
      /** «2026-03» for a month the answer names by its year and number. */
      const monthOf = (value: unknown): string | null => {
        const record = asRecord(value);
        return typeof record['year'] === 'number' && typeof record['month'] === 'number'
          ? `${record['year']}-${String(record['month']).padStart(2, '0')}`
          : null;
      };
      const monthly = (value: unknown): Record<string, unknown>[] =>
        Array.isArray(value)
          ? (value as unknown[]).map(asRecord).map((entry) => ({
              year: entry['year'] ?? null,
              month: entry['month'] ?? null,
              amount: entry['amount'] ?? null,
              count: entry['count'] ?? null,
              complete: entry['is_month_complete'] ?? null,
            }))
          : [];
      // Where the income came from, by kind and name, without the account's own references.
      const sources = (value: unknown): string[] => [
        ...new Set(
          (Array.isArray(value) ? (value as unknown[]) : [])
            .map((entry) => asRecord(asRecord(entry)['income_source']))
            .map((source) =>
              [source['type'], source['name']]
                .filter((part) => typeof part === 'string' && part !== '')
                .join(' · '),
            )
            .filter((label) => label !== ''),
        ),
      ];
      return withoutEmpty({
        income_currency: salary['currency'] ?? null,
        average_monthly_income: total['average_monthly_amount'] ?? null,
        income_payment_count: total['count'] ?? null,
        first_income_at: total['first_date_time'] ?? null,
        last_income_at: total['last_date_time'] ?? null,
        income_total: total['amount'] ?? null,
        income_monthly_count: total['average_monthly_count'] ?? null,
        income_received_average: total['average_monthly_received_value'] ?? null,
        income_highest_month: monthOf(total['maximum_monthly_amount']),
        income_highest_amount: asRecord(total['maximum_monthly_amount'])['amount'] ?? null,
        income_lowest_month: monthOf(total['minimum_monthly_amount']),
        income_lowest_amount: asRecord(total['minimum_monthly_amount'])['amount'] ?? null,
        income_months: monthly(salary['monthly_totals']),
        income_sources: sources(salary['transactions']),
        income_variation_ratio: factors['delta_min_max'] ?? null,
        income_monthly_change: factors['average_monthly_income_change'] ?? null,
        other_income_currency: other['currency'] ?? null,
        other_income_total: otherTotal['amount'] ?? null,
        other_income_monthly_average: otherTotal['average_monthly_amount'] ?? null,
        other_income_count: otherTotal['count'] ?? null,
        other_income_sources: sources(other['transactions']),
      });
    },
    /**
     * Income is read from data the provider refreshes on its own schedule. When the data
     * is not current it accepts the request, refreshes, and calls back, so this is the
     * one endpoint whose answer can arrive later.
     *
     * The exact word the upstream uses for "not ready" is the one thing here that has not
     * been seen against a live account, so it is a set rather than a single value and it
     * is in one place. Anything else is treated as an answer, which is the safe direction:
     * a wrongly awaited run closes itself at its deadline, while a wrongly completed one
     * is billed for an answer nobody has.
     */
    outcome: (payload) => {
      const status = String(payload['status'] ?? 'OK').toUpperCase();
      if (['PENDING', 'IN_PROGRESS', 'PROCESSING', 'REFRESHING', 'ACCEPTED'].includes(status)) {
        return 'AWAITING';
      }
      return status === 'OK' ? 'OK' : 'NOT_FOUND';
    },
    // Their handle for the entity, which is what the callback names too.
    correlation: (payload, input) =>
      firstString(payload, ['entity_id', 'entityId']) ??
      firstString(input, ['entity_id', 'entityId']),
  },
};

function firstString(
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

export interface LeanProviderOptions {
  name: string;
  /** The API host. The authorisation host is separate and given below. */
  baseUrl: string;
  authUrl: string;
  endpoints?: Readonly<Record<string, LeanEndpointMapping>> | undefined;
  fetch?: FetchLike;
  timeoutMs?: number;
  tokens?: TokenCache;
}

export class LeanProvider implements VerificationProvider {
  readonly name: string;
  readonly endpoints: readonly string[];

  readonly #baseUrl: string;
  readonly #authUrl: string;
  readonly #mappings: Readonly<Record<string, LeanEndpointMapping>>;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #tokens: TokenCache;

  constructor(options: LeanProviderOptions) {
    this.name = options.name;
    this.#baseUrl = options.baseUrl.replace(/\/$/, '');
    this.#authUrl = options.authUrl;
    this.#mappings = options.endpoints ?? LEAN_ENDPOINTS;
    this.endpoints = Object.keys(this.#mappings);
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#tokens =
      options.tokens ?? new TokenCache({ ...(options.fetch ? { fetch: options.fetch } : {}) });
  }

  async execute(request: ProviderRequest): Promise<ProviderResult> {
    const mapping = this.#mappings[request.endpoint];
    const started = Date.now();

    if (!mapping) {
      return {
        outcome: 'ERROR',
        authority: null,
        data: null,
        latencyMs: 0,
        errorCode: 'UNSUPPORTED_ENDPOINT',
        retryable: false,
      };
    }

    try {
      const token = await this.#tokenFor(request.credential);
      const response = await this.#post(mapping, request, token);

      if (response.status === 401) {
        // The token was accepted when it was minted and is not now. One retry with a
        // fresh one, and then it is an authentication failure rather than a transient.
        this.#tokens.forget(request.credential.ref);
        const retry = await this.#post(mapping, request, await this.#tokenFor(request.credential));
        return this.#result(mapping, retry, started, request.input);
      }

      return this.#result(mapping, response, started, request.input);
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      return {
        outcome: 'ERROR',
        authority: null,
        data: null,
        latencyMs: Date.now() - started,
        errorCode: timedOut ? 'TIMEOUT' : 'NETWORK',
        retryable: true,
      };
    }
  }

  async healthCheck(credential: ResolvedCredential): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      // Minting a token is the smallest call that proves the account works, and it costs
      // nothing: no verification is performed and nobody is charged for it.
      await this.#tokenFor(credential);
      return { status: 'healthy', checkedAt: new Date(), latencyMs: Date.now() - started };
    } catch {
      return {
        status: 'down',
        checkedAt: new Date(),
        latencyMs: Date.now() - started,
        detail: 'the identity service did not issue a token',
      };
    }
  }

  #tokenFor(credential: ResolvedCredential): Promise<string> {
    const clientId = credential.material['clientId'] ?? credential.material['appToken'] ?? '';
    const clientSecret = credential.material['clientSecret'] ?? '';
    return this.#tokens.token(credential.ref, {
      authUrl: this.#authUrl,
      clientId,
      clientSecret,
      scope: credential.material['scope'] ?? 'api',
    });
  }

  async #post(
    mapping: LeanEndpointMapping,
    request: ProviderRequest,
    token: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? this.#timeoutMs);
    try {
      return await this.#fetch(`${this.#baseUrl}${mapping.path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(request.idempotencyKey ? { 'idempotency-key': request.idempotencyKey } : {}),
        },
        body: JSON.stringify(mapping.body(request.input)),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async #result(
    mapping: LeanEndpointMapping,
    response: Response,
    started: number,
    // The request's own input, because an endpoint that answers later may name what it is
    // working on in the request rather than in the reply.
    input: Readonly<Record<string, unknown>> = {},
  ): Promise<ProviderResult> {
    const latencyMs = Date.now() - started;

    if (response.status === 401 || response.status === 403) {
      return {
        outcome: 'ERROR',
        authority: null,
        data: null,
        latencyMs,
        errorCode: 'AUTH',
        retryable: false,
      };
    }
    if (response.status === 429) {
      return {
        outcome: 'ERROR',
        authority: null,
        data: null,
        latencyMs,
        errorCode: 'RATE_LIMIT',
        retryable: true,
      };
    }
    if (response.status === 404) {
      return { outcome: 'NOT_FOUND', authority: mapping.authority, data: null, latencyMs };
    }
    if (response.status >= 500) {
      return {
        outcome: 'ERROR',
        authority: null,
        data: null,
        latencyMs,
        errorCode: 'UPSTREAM',
        retryable: true,
      };
    }

    let payload: Record<string, unknown>;
    try {
      payload = asRecord(await response.json());
    } catch {
      return {
        outcome: 'ERROR',
        authority: null,
        data: null,
        latencyMs,
        errorCode: 'MALFORMED',
        retryable: false,
      };
    }

    if (response.status >= 400) {
      return {
        outcome: 'ERROR',
        authority: null,
        data: null,
        latencyMs,
        errorCode: 'UPSTREAM',
        retryable: false,
      };
    }

    const outcome = mapping.outcome?.(payload) ?? 'OK';
    if (outcome === 'AWAITING') {
      const correlation = mapping.correlation?.(payload, input) ?? null;
      if (!correlation) {
        // Waiting with nothing to wait on is a run that never closes. Better an error
        // that says so than a case left open against an answer nobody can match.
        return {
          outcome: 'ERROR',
          authority: null,
          data: null,
          latencyMs,
          errorCode: 'MALFORMED',
          retryable: false,
        };
      }
      return { outcome, authority: mapping.authority, data: null, latencyMs, correlation };
    }
    if (outcome === 'ERROR') {
      // A failure of the source, answered politely. Not billed, and named by our code.
      return {
        outcome,
        authority: null,
        data: null,
        latencyMs,
        errorCode: mapping.failureCode?.(payload) ?? 'UPSTREAM',
        retryable: (mapping.failureCode?.(payload) ?? 'UPSTREAM') === 'UPSTREAM',
      };
    }
    if (outcome !== 'OK') {
      return {
        outcome,
        authority: mapping.authorityFor?.(payload) ?? mapping.authority,
        data: null,
        latencyMs,
      };
    }

    return {
      outcome: 'OK',
      authority: mapping.authorityFor?.(payload) ?? mapping.authority,
      data: mapping.map(payload, input),
      latencyMs,
    };
  }
}
