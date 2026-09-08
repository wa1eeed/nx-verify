import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { NxError } from '../errors.js';

/**
 * Where the rendered evidence document lives.
 *
 * A seam, like the KMS and the providers, because object storage is a deployment choice.
 * The filesystem implementation below is complete and is what a single node deployment
 * uses; an S3 or equivalent adapter implements the same three methods.
 *
 * The storage key is built from the tenant id and the run id and ends in the extension
 * of what it holds, which is what an object store adapter reads the content type from.
 * The filesystem implementation refuses a key that escapes its root. A path traversal here would let one
 * subscriber's document be written over another's.
 */

export interface EvidenceStore {
  put(key: string, content: string): Promise<void>;
  get(key: string): Promise<string | null>;
  exists(key: string): Promise<boolean>;
}

export class FilesystemEvidenceStore implements EvidenceStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async put(key: string, content: string): Promise<void> {
    const path = this.#resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }

  async get(key: string): Promise<string | null> {
    try {
      return await readFile(this.#resolveKey(key), 'utf8');
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  #resolveKey(key: string): string {
    const path = resolve(join(this.#root, normalize(key)));
    if (path !== this.#root && !path.startsWith(`${this.#root}/`)) {
      // A key that climbs out of the root would let one subscriber's document be written
      // over another's.
      throw new NxError('NX-4001', { detail: 'the storage key escapes the evidence root' });
    }
    return path;
  }
}

/** For tests, and for a deployment that has not chosen its object store yet. */
export class InMemoryEvidenceStore implements EvidenceStore {
  readonly #files = new Map<string, string>();

  put(key: string, content: string): Promise<void> {
    this.#files.set(key, content);
    return Promise.resolve();
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.#files.get(key) ?? null);
  }

  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.#files.has(key));
  }

  get size(): number {
    return this.#files.size;
  }
}
