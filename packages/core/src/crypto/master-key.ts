/**
 * Where the root key material comes from, and which version of it.
 *
 * Rule 10: no credential is stored in the database. The master key lives in a KMS in
 * every real environment, and this interface is the seam where that implementation plugs
 * in. The environment backed source below exists for local work and tests.
 *
 * Versions exist because docs/01-blueprint.md promises rotation every ninety days, and a
 * single unversioned root makes that impossible: the identifier hash is a lookup index,
 * so changing the key silently unmatches every row. Several versions are readable at
 * once, exactly one is written with, and a job moves the rows across.
 */

export interface MasterKeySource {
  /** The version new values are written with. */
  currentVersion(): Promise<number>;
  /** Returns the root key for a version. Callers must not cache beyond a request. */
  masterKey(version: number): Promise<Buffer>;
  /** Every version this source can still read. */
  availableVersions(): Promise<number[]>;
}

const MINIMUM_KEY_BYTES = 32;

function decode(base64Key: string, label: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length < MINIMUM_KEY_BYTES) {
    // The key itself is never included in the message.
    throw new Error(`${label} must decode to at least ${MINIMUM_KEY_BYTES} bytes`);
  }
  return key;
}

/**
 * Reads keys from the environment.
 *
 *   NX_MASTER_KEY=<base64>            one key, version 1
 *   NX_MASTER_KEYS=1:<b64>,2:<b64>    several, and the highest is current
 *
 * The second form is what makes a rotation rehearsal possible locally: add a version,
 * run the job, watch the rows move.
 */
export class EnvMasterKeySource implements MasterKeySource {
  readonly #keys: Map<number, Buffer>;
  readonly #current: number;

  constructor(env: Readonly<Record<string, string | undefined>> = process.env) {
    const versioned = env['NX_MASTER_KEYS'];
    const single = env['NX_MASTER_KEY'];

    if (versioned) {
      this.#keys = new Map(
        versioned
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
          .map((entry) => {
            const separator = entry.indexOf(':');
            if (separator === -1) {
              throw new Error('NX_MASTER_KEYS entries must be <version>:<base64>');
            }
            const version = Number.parseInt(entry.slice(0, separator), 10);
            if (!Number.isInteger(version) || version <= 0) {
              throw new Error('NX_MASTER_KEYS versions must be positive integers');
            }
            return [version, decode(entry.slice(separator + 1), `NX_MASTER_KEYS v${version}`)];
          }),
      );
    } else if (single) {
      this.#keys = new Map([[1, decode(single, 'NX_MASTER_KEY')]]);
    } else {
      throw new Error('neither NX_MASTER_KEY nor NX_MASTER_KEYS is set');
    }

    this.#current = Math.max(...this.#keys.keys());
  }

  currentVersion(): Promise<number> {
    return Promise.resolve(this.#current);
  }

  masterKey(version: number): Promise<Buffer> {
    const key = this.#keys.get(version);
    if (!key) {
      // Naming the version is safe. It says nothing about any key material.
      throw new Error(`no master key is available for version ${version}`);
    }
    return Promise.resolve(key);
  }

  availableVersions(): Promise<number[]> {
    return Promise.resolve([...this.#keys.keys()].sort((left, right) => left - right));
  }
}

/** For tests and for a KMS backed implementation to model. */
export class StaticMasterKeySource implements MasterKeySource {
  readonly #keys: Map<number, Buffer>;

  constructor(keys: Buffer | Map<number, Buffer>) {
    this.#keys = Buffer.isBuffer(keys) ? new Map([[1, keys]]) : keys;
    for (const [version, key] of this.#keys) {
      if (key.length < MINIMUM_KEY_BYTES) {
        throw new Error(`master key v${version} must be at least ${MINIMUM_KEY_BYTES} bytes`);
      }
    }
  }

  currentVersion(): Promise<number> {
    return Promise.resolve(Math.max(...this.#keys.keys()));
  }

  masterKey(version: number): Promise<Buffer> {
    const key = this.#keys.get(version);
    if (!key) {
      throw new Error(`no master key is available for version ${version}`);
    }
    return Promise.resolve(key);
  }

  availableVersions(): Promise<number[]> {
    return Promise.resolve([...this.#keys.keys()].sort((left, right) => left - right));
  }
}
