import { NxError } from '@nx-verify/core';

/**
 * OAuth client credentials, cached.
 *
 * The provider this serves issues tokens that last an hour and its documentation asks
 * that they be cached rather than minted per request. Caching is therefore not an
 * optimisation ahead of measurement (rule 9), it is the documented way to use the API.
 *
 * The client secret arrives from the KMS for the life of one call and is never held here:
 * what this caches is the token, keyed by the credential reference rather than by the
 * secret, so no material becomes a map key.
 */

export interface TokenRequest {
  authUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class TokenCache {
  readonly #tokens = new Map<string, CachedToken>();
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  /** Refreshed this long before expiry, so a call never carries a token about to die. */
  readonly #marginMs: number;

  constructor(options: { fetch?: FetchLike; now?: () => number; marginSeconds?: number } = {}) {
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#now = options.now ?? Date.now;
    this.#marginMs = (options.marginSeconds ?? 60) * 1000;
  }

  async token(cacheKey: string, request: TokenRequest): Promise<string> {
    const cached = this.#tokens.get(cacheKey);
    if (cached && cached.expiresAt - this.#marginMs > this.#now()) {
      return cached.token;
    }

    const response = await this.#fetch(request.authUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: request.clientId,
        client_secret: request.clientSecret,
        scope: request.scope ?? 'api',
      }).toString(),
    });

    if (!response.ok) {
      // The status, never the body: an authorisation server that echoes the client id
      // back would put it in our logs, and one that misbehaves could echo more.
      throw new NxError('NX-4011', {
        detail: `the identity service refused the client credentials (${response.status})`,
      });
    }

    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string') {
      throw new NxError('NX-5002', { detail: 'the identity service returned no token' });
    }

    const lifetime = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    this.#tokens.set(cacheKey, {
      token: body.access_token,
      expiresAt: this.#now() + lifetime * 1000,
    });
    return body.access_token;
  }

  /** Drops a cached token. Called when the upstream answers 401 with one in hand. */
  forget(cacheKey: string): void {
    this.#tokens.delete(cacheKey);
  }

  get size(): number {
    return this.#tokens.size;
  }
}
