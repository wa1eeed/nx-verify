import type { TenantTransaction } from '@nx-verify/db';
import { NxError, masterKeySourceFromEnv } from '@nx-verify/core';
import type { ProviderMode, ResolvedCredential } from './types.js';
import {
  LayeredSecretStore,
  SealedFileSecretStore,
  describeStored,
  isStored,
} from './sealed-store.js';

/**
 * Credential resolution.
 *
 * The binding is read from tenant_provider_binding, never from a global environment
 * variable, because mode and credential are per (tenant, provider) (ADR-005). The row
 * holds a KMS reference and the secret store turns that into material that lives for the
 * duration of one call.
 */

export interface SecretStore {
  /**
   * Whether this store accepts writes from a panel.
   *
   * Declared rather than inferred. Asking whether put is a function answers a question
   * about the class and not about the deployment: a store can implement put purely to
   * refuse it, and a panel that reads the method as permission renders a save button
   * that cannot save. This flag is the honest answer, and the screen reads this.
   */
  readonly writable: boolean;
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
  /**
   * What is stored under a reference, without the material: which fields, when, and a
   * fingerprint of each.
   *
   * Null means the store answered and there is nothing under the reference. It does not mean
   * the store could not be asked: an endpoint that is unreachable, a variable that does not
   * parse and an entry that will not open all raise instead (ADR-179). The two are one
   * question apart on a screen and a world apart to the person reading it, because «nothing
   * is stored here» sends somebody to put a secret in a store that may already hold it, and
   * a store that cannot be reached is nobody's mistake but the deployment's. An
   * implementation that catches its own failures and returns null tells that lie for every
   * caller at once, so none of them do, LayeredSecretStore included (ADR-185).
   *
   * Required, unlike put. ADR-179 left it optional only because callers outside its reach
   * tested it with `store.describe ?`, and a store that cannot describe is a fourth answer no
   * screen has a word for: every caller invented one, and the honest words all came out as
   * «the store did not answer», which is a failure that never happened. Every store here
   * implements it, so the type now says so and the invented sentences are gone.
   */
  describe(ref: string): Promise<SecretDescription | null>;
}

export interface SecretDescription {
  /** Null when the store does not record when a value was written. */
  updatedAt: Date | null;
  /**
   * One entry per stored field. A secret carries a short fingerprint, an identifier that
   * is not a secret carries a masked form, and neither can be turned back into the value.
   */
  fields: Record<string, { fingerprint?: string; masked?: string }>;
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
  if (binding?.credentialRef) {
    const material = await secrets.fetch(binding.credentialRef);
    return { ref: binding.credentialRef, mode: binding.mode, material };
  }

  /**
   * The platform's own connection, for the world this subscriber lives in.
   *
   * Every subscriber is served under NX's agreement with the data source, and none brings
   * a credential of their own (ADR-108). So a subscriber with no binding row, or with a
   * managed row that names no reference, uses the credential the administration panel set
   * for the sandbox or for production. Which of the two is decided by the workspace, never
   * by the request, so a sandbox cannot reach the production credential.
   */
  const { rows: sandbox } = await tx.query<{ is_sandbox: boolean }>(
    `SELECT sandbox_of IS NOT NULL AS is_sandbox FROM tenants WHERE id = $1`,
    [tx.tenantId],
  );
  const environment = sandbox[0]?.is_sandbox ? 'sandbox' : 'live';
  const { rows: connection } = await tx.query<{ credential_ref: string | null }>(
    `SELECT credential_ref FROM provider_connections
     WHERE provider = $1 AND environment = $2 AND status = 'active'`,
    [provider, environment],
  );
  const platformRef = connection[0]?.credential_ref ?? null;

  if (platformRef) {
    return { ref: platformRef, mode: 'MANAGED', material: await secrets.fetch(platformRef) };
  }

  if (!binding) {
    // The provider name is internal, so it does not go into the message (rule 5).
    throw new NxError('NX-4041', { detail: 'no provider binding for this tenant' });
  }
  throw new NxError('NX-5001', { detail: 'provider binding has no credential reference' });
}

/** For tests and local work. A KMS backed store replaces it in every real environment. */
export class InMemorySecretStore implements SecretStore {
  readonly writable = true;
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
    if (!isStored(material)) {
      // The reference is safe to name. The material never appears in an error.
      throw new NxError('NX-5001', { detail: `no secret stored for reference ${ref}` });
    }
    return Promise.resolve(material);
  }

  describe(ref: string): Promise<SecretDescription | null> {
    return Promise.resolve(describeStored(this.#entries.get(ref), null));
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
  readonly writable = false;
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

  /**
   * The variable, parsed. Raises when there is nothing to read rather than reading as empty:
   * a variable that is not set and a variable that does not parse are both this store failing
   * to answer, and neither is an answer about any one reference.
   */
  #entries(): Record<string, Record<string, string>> {
    const raw = process.env[this.#variable];
    if (!raw) {
      throw new NxError('NX-5001', { detail: `${this.#variable} is not set` });
    }
    try {
      return JSON.parse(raw) as Record<string, Record<string, string>>;
    } catch {
      // The message names the variable and never its contents.
      throw new NxError('NX-5001', { detail: `${this.#variable} is not valid JSON` });
    }
  }

  /**
   * Async for the same reason describe below is: #entries raises synchronously, and a method
   * that throws before it returns a promise escapes every `.catch` written around it. Three
   * callers do exactly that (the worker's mail job, the SSO action, the integration action),
   * so a variable that is not set would have crashed them instead of reading as «nothing
   * stored».
   */
  async fetch(ref: string): Promise<Readonly<Record<string, string>>> {
    const material = this.#entries()[ref];
    if (!isStored(material)) {
      throw new NxError('NX-5001', { detail: `no secret stored for reference ${ref}` });
    }
    return material;
  }

  /**
   * Declared async on purpose. The failures above are raised from a synchronous helper, and
   * an async function turns them into a rejection: a method that throws before it returns a
   * promise escapes every `.catch` a caller wrote around it.
   */
  async describe(ref: string): Promise<SecretDescription | null> {
    // An entry written as null in the variable, and one written as {}, are both the absence
    // fetch treats them as, and neither is a crash inside describeMaterial (ADR-185).
    return describeStored(this.#entries()[ref], null);
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
  readonly writable = true;
  readonly #endpoint: string;
  readonly #token: string;
  readonly #fetch: SecretFetcher;
  readonly #cacheMs: number;
  readonly #cache = new Map<
    string,
    { material: Readonly<Record<string, string>>; expiresAt: number }
  >();
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
      options.fetcher ?? ((url, init) => fetch(url, init) as unknown as ReturnType<SecretFetcher>);
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

    const material = await this.#load(ref);
    if (material === null) {
      // Not NX-5002: a reference the manager has nothing under is not a service that is
      // temporarily unavailable, and NX-5002 is the retryable code. Retrying a reference
      // that does not exist retries forever.
      throw new NxError('NX-5001', { detail: `no material behind reference ${ref}` });
    }
    return material;
  }

  /**
   * One request, and the answer separated from the failure to get one (ADR-179).
   *
   * Null is the manager saying there is nothing under this reference, which is what a 404 is
   * and what an empty body is. Every other status raises, because a store that could not be
   * asked has said nothing at all about the reference.
   *
   * An object with no fields is the third way of saying nothing, and it used to be the one way
   * through: `{}` is truthy and is an object, so a manager answering `{"material":{}}` handed
   * the panel a credential with no parts and the panel called it «محفوظ» (ADR-185).
   */
  async #load(ref: string): Promise<Readonly<Record<string, string>> | null> {
    const response = await this.#fetch(`${this.#endpoint}/${encodeURIComponent(ref)}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${this.#token}`, accept: 'application/json' },
    });

    if (response.status === 404) {
      return null;
    }
    if (response.status >= 400) {
      throw new NxError('NX-5002', {
        detail: `the secret manager answered ${response.status} for reference ${ref}`,
      });
    }

    const body = (await response.json()) as { material?: unknown };
    const material = body.material;
    if (!material || typeof material !== 'object' || Array.isArray(material)) {
      return null;
    }

    const entries = Object.fromEntries(
      Object.entries(material as Record<string, unknown>).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
    if (!isStored(entries)) {
      return null;
    }
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

  async describe(ref: string): Promise<SecretDescription | null> {
    const cached = this.#cache.get(ref);
    if (cached && cached.expiresAt > this.#now()) {
      return describeStored(cached.material, null);
    }
    return describeStored(await this.#load(ref), null);
  }
}

/**
 * The store a deployment actually gets.
 *
 * A secret manager when one is configured. Otherwise a sealed file when one is named,
 * which the administration panel can write, layered over the environment so references
 * set there before the file existed keep working. The environment alone only outside
 * production, for the same reason the key source refuses it there.
 */
export function secretStoreFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SecretStore {
  if (env['NX_SECRETS_ENDPOINT']) {
    return HttpSecretStore.fromEnv(env);
  }
  if (env['NX_SECRETS_FILE']) {
    const sealed = new SealedFileSecretStore({
      path: env['NX_SECRETS_FILE'],
      keys: masterKeySourceFromEnv(env),
    });
    return env['NX_SECRETS'] ? new LayeredSecretStore([sealed, new EnvSecretStore()]) : sealed;
  }
  if (env['NODE_ENV'] === 'production') {
    throw new Error('NX_SECRETS_ENDPOINT or NX_SECRETS_FILE is required in production');
  }
  return new EnvSecretStore();
}
