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

/**
 * Reads the keys from a file rather than from the environment (ADR-151).
 *
 *   NX_MASTER_KEY_FILE=/var/lib/nx-keys/master
 *
 * The file holds what the variables would have held: one base64 key on a line, or several
 * `<version>:<base64>` lines. Blank lines and `#` comments are ignored, so a deployment can
 * say in the file itself when a version was added.
 *
 * **Why a file is allowed in production where a variable is not.** An environment variable is
 * readable by anything that can call `docker inspect`, anything that can read
 * `/proc/<pid>/environ`, every crash reporter that dumps the environment, and the deployment
 * tool's own interface, where it is typed into a form and then displayed back. A file at 0600
 * on a volume is readable by the process user and by root, which is the same audience that
 * could read the process memory anyway. That is the same argument that already lets the
 * sealed secret store hold every provider credential in a file in production, and the master
 * key has no business being held to a weaker standard than the things it seals.
 *
 * A key service is still the right answer where there is one, and it is still tried first.
 * This exists so that a platform on one machine is not forced to choose between standing up
 * a key service and running with `NODE_ENV=development`, which would switch off far more than
 * this one check.
 */
export class FileMasterKeySource implements MasterKeySource {
  readonly #inner: MasterKeySource;

  constructor(path: string, read: (at: string) => string) {
    const contents = read(path);
    const lines = contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    if (lines.length === 0) {
      throw new Error('NX_MASTER_KEY_FILE holds no key');
    }

    // One line with no version is version 1, exactly as NX_MASTER_KEY is.
    const versioned = lines.some((line) => /^\d+:/.test(line));
    const keys = new Map<number, Buffer>();
    for (const line of lines) {
      if (!versioned) {
        keys.set(1, decode(line, 'NX_MASTER_KEY_FILE'));
        continue;
      }
      const separator = line.indexOf(':');
      const version = Number.parseInt(line.slice(0, separator), 10);
      if (!Number.isInteger(version) || version <= 0) {
        throw new Error('NX_MASTER_KEY_FILE versions must be positive integers');
      }
      keys.set(version, decode(line.slice(separator + 1), `NX_MASTER_KEY_FILE v${version}`));
    }

    this.#inner = new StaticMasterKeySource(keys);
  }

  currentVersion(): Promise<number> {
    return this.#inner.currentVersion();
  }

  masterKey(version: number): Promise<Buffer> {
    return this.#inner.masterKey(version);
  }

  availableVersions(): Promise<number[]> {
    return this.#inner.availableVersions();
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
