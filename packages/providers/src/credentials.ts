import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '@nx-verify/core';
import type { ProviderMode, ResolvedCredential } from './types.js';

/**
 * Credential resolution.
 *
 * The binding is read from tenant_provider_binding, never from a global environment
 * variable, because mode and credential are per (tenant, provider) (ADR-005). The row
 * holds a KMS reference and the secret store turns that into material that lives for the
 * duration of one call.
 */

export interface SecretStore {
  /** Fetches the material behind a kms:// reference. */
  fetch(ref: string): Promise<Readonly<Record<string, string>>>;
  /**
   * Writes material under a reference, where the store allows it.
   *
   * This exists so an administrator can set a provider's credential from the operator
   * panel without a deployment, and it deliberately does not make the database a place
   * credentials can live: the panel writes through to the store, and our tables keep the
   * reference alone (rule 10). A store that cannot be written to says so rather than
   * pretending, and the panel then shows what to run instead.
   */
  put?(ref: string, material: Record<string, string>): Promise<void>;
}

export interface ProviderBinding {
  provider: string;
  mode: ProviderMode;
  credentialRef: string | null;
  rateLimitRps: number;
  healthStatus: string;
  activatedAt: Date | null;
}

export async function getProviderBinding(
  tx: TenantTransaction,
  provider: string,
): Promise<ProviderBinding | null> {
  const { rows } = await tx.query<{
    provider: string;
    mode: ProviderMode;
    credential_ref: string | null;
    rate_limit_rps: number;
    health_status: string;
    activated_at: Date | null;
  }>(
    `SELECT provider, mode, credential_ref, rate_limit_rps, health_status, activated_at
     FROM tenant_provider_binding
     WHERE tenant_id = $1 AND provider = $2`,
    [tx.tenantId, provider],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    provider: row.provider,
    mode: row.mode,
    credentialRef: row.credential_ref,
    rateLimitRps: row.rate_limit_rps,
    healthStatus: row.health_status,
    activatedAt: row.activated_at,
  };
}

export async function resolveCredential(
  tx: TenantTransaction,
  secrets: SecretStore,
  provider: string,
  credentialRef?: string | null,
): Promise<ResolvedCredential> {
  // A binding that named its own reference wins, because the routing chain already chose
  // that binding and the reference travels with it.
  if (credentialRef) {
    return { ref: credentialRef, mode: 'BYOC', material: await secrets.fetch(credentialRef) };
  }

  const binding = await getProviderBinding(tx, provider);
  if (!binding) {
    // The provider name is internal, so it does not go into the message (rule 5).
    throw new NxError('NX-4041', { detail: 'no provider binding for this tenant' });
  }
  if (!binding.credentialRef) {
    throw new NxError('NX-5001', { detail: 'provider binding has no credential reference' });
  }

  const material = await secrets.fetch(binding.credentialRef);
  return { ref: binding.credentialRef, mode: binding.mode, material };
}

/** For tests and local work. A KMS backed store replaces it in every real environment. */
export class InMemorySecretStore implements SecretStore {
  readonly #entries: Map<string, Readonly<Record<string, string>>>;

  constructor(entries: Record<string, Record<string, string>> = {}) {
    this.#entries = new Map(Object.entries(entries));
  }

  set(ref: string, material: Record<string, string>): void {
    this.#entries.set(ref, material);
  }

  put(ref: string, material: Record<string, string>): Promise<void> {
    this.#entries.set(ref, material);
    return Promise.resolve();
  }

  fetch(ref: string): Promise<Readonly<Record<string, string>>> {
    const material = this.#entries.get(ref);
    if (!material) {
      // The reference is safe to name. The material never appears in an error.
      throw new NxError('NX-5001', { detail: `no secret stored for reference ${ref}` });
    }
    return Promise.resolve(material);
  }
}

/**
 * Secrets from the environment of the process.
 *
 * A stopgap with one honest property: the material is not in the database and not in a
 * backup of it, which is what rule 10 is about. It is still visible to anyone who can
 * read the process environment, so a KMS backed store replaces it wherever that matters.
 *
 * NX_SECRETS holds a JSON object of reference to material:
 *   {"kms://tenants/acme/idp":{"clientSecret":"..."}}
 */
export class EnvSecretStore implements SecretStore {
  readonly #variable: string;

  constructor(variable = 'NX_SECRETS') {
    this.#variable = variable;
  }

  /**
   * The environment cannot be written to from a running process in any way that survives
   * a restart, so this says so plainly instead of appearing to work.
   */
  // Rejects rather than throwing synchronously: the caller awaits it, and a method that
  // returns a promise and then throws before returning one surprises every caller.
  put(ref: string): Promise<void> {
    return Promise.reject(
      new NxError('NX-4031', {
        detail:
          `this deployment reads secrets from ${this.#variable}, which a panel cannot write. ` +
          `Set ${ref} in that variable, or configure a secret manager with NX_SECRETS_ENDPOINT.`,
      }),
    );
  }

  fetch(ref: string): Promise<Readonly<Record<string, string>>> {
    const raw = process.env[this.#variable];
    if (!raw) {
      throw new NxError('NX-5001', { detail: `${this.#variable} is not set` });
    }

    let parsed: Record<string, Record<string, string>>;
    try {
      parsed = JSON.parse(raw) as Record<string, Record<string, string>>;
    } catch {
      // The message names the variable and never its contents.
      throw new NxError('NX-5001', { detail: `${this.#variable} is not valid JSON` });
    }

    const material = parsed[ref];
    if (!material) {
      throw new NxError('NX-5001', { detail: `no secret stored for reference ${ref}` });
    }
    return Promise.resolve(material);
  }
}

export type SecretFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

/**
 * Provider credentials from a secret manager, over HTTP.
 *
 * The same shape as the KMS key source and for the same reason: a vendor SDK here would
 * put a cloud account into the dependency graph of every test in the repository, and
 * every managed secret manager offers one request that turns a reference into material.
 *
 * A reference is safe to name in an error. The material never is, so a failure carries
 * the status and the reference and nothing from the response body.
 */
export class HttpSecretStore implements SecretStore {
  readonly #endpoint: string;
  readonly #token: string;
  readonly #fetch: SecretFetcher;
  readonly #cacheMs: number;
  readonly #cache = new Map<string, { material: Readonly<Record<string, string>>; expiresAt: number }>();
  readonly #now: () => number;

  constructor(options: {
    endpoint: string;
    token: string;
    cacheSeconds?: number;
    fetcher?: SecretFetcher;
    now?: () => number;
  }) {
    this.#endpoint = options.endpoint.replace(/\/$/, '');
    this.#token = options.token;
    this.#cacheMs = (options.cacheSeconds ?? 60) * 1000;
    this.#now = options.now ?? Date.now;
    this.#fetch =
      options.fetcher ??
      ((url, init) => fetch(url, init) as unknown as ReturnType<SecretFetcher>);
  }

  static fromEnv(env: Readonly<Record<string, string | undefined>> = process.env): HttpSecretStore {
    const endpoint = env['NX_SECRETS_ENDPOINT'];
    const token = env['NX_SECRETS_TOKEN'];
    if (!endpoint || !token) {
      throw new Error('NX_SECRETS_ENDPOINT and NX_SECRETS_TOKEN are required');
    }
    return new HttpSecretStore({ endpoint, token });
  }

  async fetch(ref: string): Promise<Readonly<Record<string, string>>> {
    const cached = this.#cache.get(ref);
    if (cached && cached.expiresAt > this.#now()) {
      return cached.material;
    }

    const response = await this.#fetch(`${this.#endpoint}/${encodeURIComponent(ref)}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${this.#token}`, accept: 'application/json' },
    });

    if (response.status >= 400) {
      throw new NxError('NX-5002', {
        detail: `the secret manager answered ${response.status} for reference ${ref}`,
      });
    }

    const body = (await response.json()) as { material?: unknown };
    const material = body.material;
    if (!material || typeof material !== 'object') {
      throw new NxError('NX-5001', { detail: `no material behind reference ${ref}` });
    }

    const entries = Object.fromEntries(
      Object.entries(material as Record<string, unknown>).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
    // Held briefly. A call per verification would make the secret manager the slowest
    // thing in a run, and holding it forever would outlive a rotation.
    this.#cache.set(ref, { material: entries, expiresAt: this.#now() + this.#cacheMs });
    return entries;
  }

  /**
   * Writes the material to the secret manager and drops what was cached for it.
   *
   * The response body is never read on failure, here as everywhere: a secret manager that
   * echoes its input back would put the material in our logs.
   */
  async put(ref: string, material: Record<string, string>): Promise<void> {
    const response = await this.#fetch(`${this.#endpoint}/${encodeURIComponent(ref)}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${this.#token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ material }),
    } as never);

    if (response.status >= 400) {
      throw new NxError('NX-5002', {
        detail: `the secret manager answered ${response.status} for reference ${ref}`,
      });
    }
    this.forget(ref);
  }

  forget(ref?: string): void {
    if (ref === undefined) {
      this.#cache.clear();
      return;
    }
    this.#cache.delete(ref);
  }
}

/**
 * The store a deployment actually gets: a secret manager if one is configured, and the
 * environment otherwise, refusing the environment in production for the same reason the
 * key source does.
 */
export function secretStoreFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SecretStore {
  if (env['NX_SECRETS_ENDPOINT']) {
    return HttpSecretStore.fromEnv(env);
  }
  if (env['NODE_ENV'] === 'production') {
    throw new Error('NX_SECRETS_ENDPOINT is required in production');
  }
  return new EnvSecretStore();
}
