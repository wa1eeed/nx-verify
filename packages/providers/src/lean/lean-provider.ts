import { TokenCache, type FetchLike } from './token.js';
import type {
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
  /** Turns the upstream payload into the flat bag normalisation expects. */
  map: (payload: Record<string, unknown>) => Record<string, unknown>;
  /** Reads the upstream's own status vocabulary. */
  outcome?: (payload: Record<string, unknown>) => 'OK' | 'NOT_FOUND' | 'ERROR';
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * The endpoints, as data.
 *
 * Adding one is a table entry. The bodies name the provider's fields and the maps name
 * ours, and the two vocabularies meet here and nowhere else.
 */
export const LEAN_ENDPOINTS: Readonly<Record<string, LeanEndpointMapping>> = {
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
      return {
        // Our names, which step_field_map rows reference, so the product definition does
        // not move when the provider behind the step changes.
        match_result: verifications['account_ownership_verified'] === true ? 'MATCH' : 'NO_MATCH',
        account_holder_name: verifications['account_holder_name'] ?? null,
        account_status: verifications['account_status'] ?? null,
        account_currency: verifications['account_currency'] ?? null,
        match_score: matching['score'] ?? null,
        verification_method: verifications['verification_method'] ?? null,
      };
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
      return {
        match_result: data['match_type'] ?? null,
        name_provided: data['full_name_provided'] ?? null,
        name_retrieved: data['full_name_retrieved'] ?? null,
        match_confidence: data['confidence'] ?? null,
      };
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
      const salary = asRecord(payload['salary']);
      const total = asRecord(salary['total']);
      return {
        income_currency: salary['currency'] ?? null,
        average_monthly_income: total['average_monthly_amount'] ?? null,
        income_payment_count: total['count'] ?? null,
        first_income_at: total['first_date_time'] ?? null,
        last_income_at: total['last_date_time'] ?? null,
      };
    },
  },
};

export interface LeanProviderOptions {
  name: string;
  /** The API host. The authorisation host is separate and given below. */
  baseUrl: string;
  authUrl: string;
  endpoints?: Readonly<Record<string, LeanEndpointMapping>>;
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
    this.#tokens = options.tokens ?? new TokenCache({ ...(options.fetch ? { fetch: options.fetch } : {}) });
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
        return this.#result(mapping, retry, started);
      }

      return this.#result(mapping, response, started);
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
  ): Promise<ProviderResult> {
    const latencyMs = Date.now() - started;

    if (response.status === 401 || response.status === 403) {
      return { outcome: 'ERROR', authority: null, data: null, latencyMs, errorCode: 'AUTH', retryable: false };
    }
    if (response.status === 429) {
      return { outcome: 'ERROR', authority: null, data: null, latencyMs, errorCode: 'RATE_LIMIT', retryable: true };
    }
    if (response.status === 404) {
      return { outcome: 'NOT_FOUND', authority: mapping.authority, data: null, latencyMs };
    }
    if (response.status >= 500) {
      return { outcome: 'ERROR', authority: null, data: null, latencyMs, errorCode: 'UPSTREAM', retryable: true };
    }

    let payload: Record<string, unknown>;
    try {
      payload = asRecord(await response.json());
    } catch {
      return { outcome: 'ERROR', authority: null, data: null, latencyMs, errorCode: 'MALFORMED', retryable: false };
    }

    if (response.status >= 400) {
      return { outcome: 'ERROR', authority: null, data: null, latencyMs, errorCode: 'UPSTREAM', retryable: false };
    }

    const outcome = mapping.outcome?.(payload) ?? 'OK';
    if (outcome !== 'OK') {
      return { outcome, authority: mapping.authority, data: null, latencyMs };
    }

    return {
      outcome: 'OK',
      authority: mapping.authority,
      data: mapping.map(payload),
      latencyMs,
    };
  }
}
