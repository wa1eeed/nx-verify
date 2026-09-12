import { createHash } from 'node:crypto';

/**
 * The MCP server talks to NX Trust through its public API, not through the database.
 *
 * This is the whole design in one sentence. Authentication, scopes, idempotency, pricing,
 * the wallet hold, the audit trail and the rule 5 check on the way out all live in the
 * API. A server that reached the database directly would be a second front door with its
 * own version of every one of those, and the second version is always the one with the
 * hole in it. See ADR-049.
 */

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface RequestOptions {
  body?: unknown;
  /** Rule 7. Sent on every write, derived rather than invented. */
  idempotencyKey?: string;
}

export interface NxApiClient {
  request(method: 'GET' | 'POST', path: string, options?: RequestOptions): Promise<ApiResponse>;
}

export class HttpApiClient implements NxApiClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#apiKey = apiKey;
  }

  async request(
    method: 'GET' | 'POST',
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse> {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        'content-type': 'application/json',
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

    const text = await response.text();
    let body: unknown = text;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      // A document endpoint returns HTML. Leave it as text.
    }
    return { status: response.status, body };
  }
}

/**
 * The idempotency key for a tool call.
 *
 * Derived from what the caller asked for, never generated fresh, because the caller here
 * is a model that will retry a call it thinks timed out. A fresh key on a retry is a
 * second charge for the same work, and rule 7 exists for exactly this case. The
 * subject is hashed rather than carried, so no identifier reaches a header (rule 4).
 */
export function idempotencyKeyFor(product: string, reference: string, subject: unknown): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ product, reference, subject }))
    .digest('hex')
    .slice(0, 32);
  return `mcp-${digest}`;
}
