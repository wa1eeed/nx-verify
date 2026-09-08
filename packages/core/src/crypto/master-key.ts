/**
 * Where the root key material comes from.
 *
 * Rule 10: no credential is stored in the database. The master key lives in a KMS in
 * every real environment, and this interface is the seam where that implementation
 * plugs in. The environment backed source below exists for local work and tests.
 */
export interface MasterKeySource {
  /** Returns the root key. Callers must not cache the result beyond a request. */
  masterKey(): Promise<Buffer>;
}

const MINIMUM_KEY_BYTES = 32;

export class EnvMasterKeySource implements MasterKeySource {
  readonly #key: Buffer;

  constructor(base64Key: string | undefined = process.env['NX_MASTER_KEY']) {
    if (!base64Key) {
      throw new Error('NX_MASTER_KEY is not set');
    }
    const key = Buffer.from(base64Key, 'base64');
    if (key.length < MINIMUM_KEY_BYTES) {
      // The key itself is never included in the message.
      throw new Error(`NX_MASTER_KEY must decode to at least ${MINIMUM_KEY_BYTES} bytes`);
    }
    this.#key = key;
  }

  masterKey(): Promise<Buffer> {
    return Promise.resolve(this.#key);
  }
}

/** A KMS backed source is added in the deployment work. The seam is this interface. */
export class StaticMasterKeySource implements MasterKeySource {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (key.length < MINIMUM_KEY_BYTES) {
      throw new Error(`master key must be at least ${MINIMUM_KEY_BYTES} bytes`);
    }
    this.#key = key;
  }

  masterKey(): Promise<Buffer> {
    return Promise.resolve(this.#key);
  }
}
