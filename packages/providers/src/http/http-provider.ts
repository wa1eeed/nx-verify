import {
  DEFAULT_ENDPOINTS,
  buildPath,
  mapResponse,
  type EndpointMapping,
} from './response-mapping.js';
import { failureForStatus, failureForThrown, isSubjectAbsent } from './errors.js';
import type {
  ProviderHealth,
  ProviderRequest,
  ProviderResult,
  ResolvedCredential,
  VerificationProvider,
} from '../types.js';

/**
 * A real provider over HTTP.
 *
 * Unit 9 is the test docs/00-START-HERE.md sets for the abstraction: if connecting a real
 * provider needs a change anywhere outside this package, the abstraction failed. This
 * class implements the same interface the stub does, is registered the same way, and the
 * domain layer cannot tell them apart. Swapping one for the other is a line in the
 * registry.
 *
 * It carries no live account. `fetch` is injected, so the whole adapter is exercised
 * against recorded upstream responses, and pointing it at a sandbox is configuration.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpProviderOptions {
  name: string;
  baseUrl: string;
  endpoints?: Readonly<Record<string, EndpointMapping>>;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Transient failures only. An auth failure is never retried. */
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Reads what the provider charged us, when it reports it in a header. */
  costHeader?: string;
}

export class HttpVerificationProvider implements VerificationProvider {
  readonly name: string;
  readonly endpoints: readonly string[];

  readonly #baseUrl: string;
  readonly #mappings: Readonly<Record<string, EndpointMapping>>;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #retryDelayMs: number;
  readonly #costHeader: string;

  constructor(options: HttpProviderOptions) {
    this.name = options.name;
    this.#baseUrl = options.baseUrl.replace(/\/$/, '');
    this.#mappings = options.endpoints ?? DEFAULT_ENDPOINTS;
    this.endpoints = Object.keys(this.#mappings);
    this.#fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.#timeoutMs = options.timeoutMs ?? 8_000;
    this.#maxAttempts = options.maxAttempts ?? 3;
    this.#retryDelayMs = options.retryDelayMs ?? 200;
    this.#costHeader = options.costHeader ?? 'x-charge-amount';
  }

  async execute(request: ProviderRequest): Promise<ProviderResult> {
    const mapping = this.#mappings[request.endpoint];
    if (!mapping) {
      return this.#failure('UNSUPPORTED_ENDPOINT', false, 0, null);
    }

    const startedAt = Date.now();
    let last: ProviderResult | null = null;

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const result = await this.#attempt(mapping, request, startedAt);
      if (result.outcome !== 'ERROR' || result.retryable !== true) {
        return result;
      }
      last = result;
      if (attempt < this.#maxAttempts) {
        // Exponential, so a provider having a bad minute is not made worse by us.
        await delay(this.#retryDelayMs * 2 ** (attempt - 1));
      }
    }

    return last ?? this.#failure('UPSTREAM', true, Date.now() - startedAt, null);
  }

  async healthCheck(credential: ResolvedCredential): Promise<ProviderHealth> {
    const startedAt = Date.now();
    try {
      const response = await this.#send('/health', 'GET', null, credential);
      const latencyMs = Date.now() - startedAt;
      return {
        status: response.ok ? 'healthy' : response.status >= 500 ? 'down' : 'degraded',
        checkedAt: new Date(),
        latencyMs,
      };
    } catch {
      return { status: 'down', checkedAt: new Date(), latencyMs: Date.now() - startedAt };
    }
  }

  async #attempt(
    mapping: EndpointMapping,
    request: ProviderRequest,
    startedAt: number,
  ): Promise<ProviderResult> {
    const { path, body } = buildPath(mapping, request.input);

    let response: Response;
    try {
      response = await this.#send(
        path,
        mapping.method,
        body,
        request.credential,
        request.idempotencyKey,
      );
    } catch (error) {
      const failure = failureForThrown(error);
      return this.#failure(failure.errorCode, failure.retryable, Date.now() - startedAt, null);
    }

    const latencyMs = Date.now() - startedAt;
    const payload = await readJson(response);

    if (response.status === 404 && isSubjectAbsent(response.status, payload)) {
      // The authority answered and the subject is not there. That is a result, and it is
      // billed at the negative rate rather than not at all.
      return {
        outcome: 'NOT_FOUND',
        authority: mapping.authority,
        data: null,
        latencyMs,
        ...costOf(response, this.#costHeader),
      };
    }

    if (!response.ok) {
      const failure = failureForStatus(response.status);
      return this.#failure(failure.errorCode, failure.retryable, latencyMs, null);
    }

    const data = mapResponse(mapping, payload);
    if (data === null) {
      // Two hundred with nothing usable in it. Treated as an absent subject rather than
      // an error, because the call did reach the authority and did cost us.
      return {
        outcome: 'NOT_FOUND',
        authority: mapping.authority,
        data: null,
        latencyMs,
        ...costOf(response, this.#costHeader),
      };
    }

    return {
      outcome: 'OK',
      authority: mapping.authority,
      data,
      latencyMs,
      ...costOf(response, this.#costHeader),
    };
  }

  #send(
    path: string,
    method: 'GET' | 'POST',
    body: Record<string, unknown> | null,
    credential: ResolvedCredential,
    idempotencyKey?: string | undefined,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      // Rule 10: the material is used here and never stored, logged or returned.
      ...authHeaders(credential),
    };
    if (body !== null) {
      headers['content-type'] = 'application/json';
    }
    if (idempotencyKey) {
      // Passed upstream so that our retry is not a second charge to us either.
      headers['idempotency-key'] = idempotencyKey;
    }

    return this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      headers,
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
  }

  #failure(
    errorCode: ProviderResult['errorCode'],
    retryable: boolean,
    latencyMs: number,
    authority: string | null,
  ): ProviderResult {
    return { outcome: 'ERROR', authority, data: null, latencyMs, errorCode, retryable };
  }
}

function authHeaders(credential: ResolvedCredential): Record<string, string> {
  const material = credential.material;
  const headers: Record<string, string> = {};
  if (material['apiKey']) {
    headers['apikey'] = material['apiKey'];
  }
  if (material['bearerToken']) {
    headers['authorization'] = `Bearer ${material['bearerToken']}`;
  }
  return headers;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text.length === 0 ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function costOf(response: Response, header: string): { providerCost?: number } {
  const raw = response.headers.get(header);
  if (raw === null) {
    return {};
  }
  const value = Number(raw);
  return Number.isFinite(value) ? { providerCost: value } : {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
