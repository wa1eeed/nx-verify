import { NxError } from '../errors.js';
import { EnvMasterKeySource, type MasterKeySource } from './master-key.js';

/**
 * The root key, from a key management service.
 *
 * A real KMS does not hand out root key material. It holds a key that never leaves it and
 * decrypts on request, so what a deployment stores is an encrypted data key, and what
 * this does is ask the service to turn that into a usable one. This is the envelope
 * pattern, and it is the shape every managed KMS offers.
 *
 * Which service is not decided here. The call is one HTTP request, defined by a small
 * interface, so pointing this at a cloud KMS is a subclass or a proxy rather than a
 * change in the domain. The alternative, a vendor SDK in this package, would put a cloud
 * account in the dependency graph of every test in the repository.
 *
 * The plaintext key is held in memory for a short time and never written anywhere: not to
 * a log, not to an error message, not to the database. See ADR-057.
 */

export interface KmsDecryptRequest {
  /** The stored ciphertext of the data key, as the service gave it. */
  ciphertext: string;
  keyVersion: number;
}

export interface KmsClient {
  /** Returns the plaintext data key. Never called for a version that is not configured. */
  decrypt(request: KmsDecryptRequest): Promise<Buffer>;
}

export interface HttpKmsOptions {
  endpoint: string;
  token: string;
  /** The encrypted data key for each readable version. */
  ciphertexts: Record<number, string>;
  /** Defaults to the highest configured version. */
  currentVersion?: number;
  /** How long a decrypted key may be reused before the service is asked again. */
  cacheSeconds?: number;
  client?: KmsClient;
  now?: () => number;
}

const MINIMUM_KEY_BYTES = 32;

export class KmsMasterKeySource implements MasterKeySource {
  readonly #client: KmsClient;
  readonly #ciphertexts: Map<number, string>;
  readonly #current: number;
  readonly #cacheMs: number;
  readonly #now: () => number;
  readonly #cache = new Map<number, { key: Buffer; expiresAt: number }>();

  constructor(options: HttpKmsOptions) {
    this.#ciphertexts = new Map(
      Object.entries(options.ciphertexts).map(([version, ciphertext]) => [
        Number.parseInt(version, 10),
        ciphertext,
      ]),
    );

    if (this.#ciphertexts.size === 0) {
      throw new Error('a KMS key source needs at least one configured version');
    }

    this.#client = options.client ?? new HttpKmsClient(options.endpoint, options.token);
    this.#current = options.currentVersion ?? Math.max(...this.#ciphertexts.keys());
    this.#cacheMs = (options.cacheSeconds ?? 300) * 1000;
    this.#now = options.now ?? Date.now;

    if (!this.#ciphertexts.has(this.#current)) {
      throw new Error(`the current version ${this.#current} has no configured key`);
    }
  }

  /**
   * Reads the configuration from the environment.
   *
   *   NX_KMS_ENDPOINT, NX_KMS_TOKEN
   *   NX_KMS_KEYS=1:<ciphertext>,2:<ciphertext>
   *
   * The ciphertexts are safe to put in configuration, which is the whole point of the
   * envelope: they are useless to anyone who cannot call the service.
   */
  static fromEnv(env: Readonly<Record<string, string | undefined>> = process.env): KmsMasterKeySource {
    const endpoint = env['NX_KMS_ENDPOINT'];
    const token = env['NX_KMS_TOKEN'];
    const keys = env['NX_KMS_KEYS'];
    if (!endpoint || !token || !keys) {
      throw new Error('NX_KMS_ENDPOINT, NX_KMS_TOKEN and NX_KMS_KEYS are required');
    }

    const ciphertexts: Record<number, string> = {};
    for (const entry of keys.split(',').map((value) => value.trim()).filter(Boolean)) {
      const separator = entry.indexOf(':');
      if (separator === -1) {
        throw new Error('NX_KMS_KEYS entries must be <version>:<ciphertext>');
      }
      const version = Number.parseInt(entry.slice(0, separator), 10);
      if (!Number.isInteger(version) || version <= 0) {
        throw new Error('NX_KMS_KEYS versions must be positive integers');
      }
      ciphertexts[version] = entry.slice(separator + 1);
    }

    return new KmsMasterKeySource({ endpoint, token, ciphertexts });
  }

  currentVersion(): Promise<number> {
    return Promise.resolve(this.#current);
  }

  availableVersions(): Promise<number[]> {
    return Promise.resolve([...this.#ciphertexts.keys()].sort((a, b) => a - b));
  }

  async masterKey(version: number): Promise<Buffer> {
    const cached = this.#cache.get(version);
    if (cached && cached.expiresAt > this.#now()) {
      return cached.key;
    }

    const ciphertext = this.#ciphertexts.get(version);
    if (!ciphertext) {
      // Naming the version is safe. It says nothing about any key material.
      throw new Error(`no master key is available for version ${version}`);
    }

    const key = await this.#client.decrypt({ ciphertext, keyVersion: version });
    if (key.length < MINIMUM_KEY_BYTES) {
      throw new Error(`the key management service returned fewer than ${MINIMUM_KEY_BYTES} bytes`);
    }

    // Held briefly, because every verification needs it and a call per identifier would
    // make the service the slowest thing in the platform. Held in memory only.
    this.#cache.set(version, { key, expiresAt: this.#now() + this.#cacheMs });
    return key;
  }

  /** Drops the cached material. Called on shutdown, and by a rotation that retires one. */
  forget(version?: number): void {
    if (version === undefined) {
      this.#cache.clear();
      return;
    }
    this.#cache.delete(version);
  }
}

export type Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

/**
 * One request, and nothing about it in an error.
 *
 * A failure names the status and the version. It never carries the response body, because
 * a service that echoes its input back would put a ciphertext, and one that misbehaves
 * could put a key, into our logs.
 */
export class HttpKmsClient implements KmsClient {
  readonly #endpoint: string;
  readonly #token: string;
  readonly #fetch: Fetcher;

  constructor(endpoint: string, token: string, fetcher?: Fetcher) {
    this.#endpoint = endpoint;
    this.#token = token;
    this.#fetch = fetcher ?? ((url, init) => fetch(url, init) as unknown as ReturnType<Fetcher>);
  }

  async decrypt(request: KmsDecryptRequest): Promise<Buffer> {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ciphertext: request.ciphertext, key_version: request.keyVersion }),
    });

    if (response.status >= 400) {
      throw new NxError('NX-5002', {
        detail: `the key management service answered ${response.status} for version ${request.keyVersion}`,
      });
    }

    const body = (await response.json()) as { plaintext?: unknown };
    if (typeof body.plaintext !== 'string') {
      throw new NxError('NX-5002', { detail: 'the key management service returned no key' });
    }
    return Buffer.from(body.plaintext, 'base64');
  }
}

/**
 * The source a deployment actually gets.
 *
 * A key service if one is configured, and the environment otherwise. Written once here
 * rather than as an `if` in each of the three processes, so no process can end up on the
 * development path in production because somebody wired it differently.
 */
export function masterKeySourceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MasterKeySource {
  if (env['NX_KMS_ENDPOINT']) {
    return KmsMasterKeySource.fromEnv(env);
  }
  if (env['NODE_ENV'] === 'production') {
    // A convenience that survives into a deployment is not a convenience. The same
    // argument the console makes about its development session fallback.
    throw new Error('NX_KMS_ENDPOINT is required in production');
  }
  return new EnvMasterKeySource(env);
}
