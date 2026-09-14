import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { NxError, type MasterKeySource } from '@nx-verify/core';
import type { SecretDescription, SecretStore } from './credentials.js';

/**
 * Secrets sealed in a file the panel can write to.
 *
 * The owner asked for the data source's credentials, for both environments, to be set and
 * changed from the administration panel rather than from a deployment. Rule 10 says where
 * they may not live: in the database, where they would travel into every backup and every
 * read replica. A managed secret manager is the best home and HttpSecretStore speaks to
 * one. Where there is none yet, this is the honest second best:
 *
 * - The file lives on a volume the services share, never in the database.
 * - Every entry is sealed with AES-256-GCM under a key derived from the master key
 *   source, so the file alone is ciphertext, and a copy of the database alone holds only
 *   the kms:// reference.
 * - The reference is bound into each entry as additional authenticated data, so an entry
 *   copied under another reference fails to open rather than handing one environment's
 *   credential to the other.
 * - The key version is recorded per entry, so rotating the master key leaves older
 *   entries readable until they are next written.
 *
 * Writes replace the file atomically: a new file is written and flushed beside the old one
 * and renamed over it, so a reader sees the old file or the new one and never half of
 * either. Writes from this process are serialised. Two processes writing at the same
 * moment would lose one write, and the panel is the only writer, so that is accepted and
 * written down here rather than solved with a lock nobody needs yet (rule 9).
 */

const FORMAT = 'nx-sealed-secrets/v1';
const KEY_INFO = 'nx-verify/secret-store/v1';

interface SealedEntry {
  /** Master key version the entry was sealed with. */
  v: number;
  iv: string;
  tag: string;
  data: string;
  updatedAt: string;
}

interface SealedFile {
  format: typeof FORMAT;
  entries: Record<string, SealedEntry>;
}

export class SealedFileSecretStore implements SecretStore {
  readonly writable = true;
  readonly #path: string;
  readonly #keys: MasterKeySource;
  #writing: Promise<void> = Promise.resolve();
  #cache: { mtimeMs: number; size: number; file: SealedFile } | null = null;

  constructor(options: { path: string; keys: MasterKeySource }) {
    this.#path = options.path;
    this.#keys = options.keys;
  }

  async fetch(ref: string): Promise<Readonly<Record<string, string>>> {
    const file = await this.#read();
    const entry = file.entries[ref];
    if (!entry) {
      // The reference is safe to name. Material never appears in an error.
      throw new NxError('NX-5001', { detail: `no secret stored for reference ${ref}` });
    }
    return this.#open(ref, entry);
  }

  async describe(ref: string): Promise<SecretDescription | null> {
    const file = await this.#read();
    const entry = file.entries[ref];
    if (!entry) {
      return null;
    }
    return describeMaterial(await this.#open(ref, entry), new Date(entry.updatedAt));
  }

  put(ref: string, material: Record<string, string>): Promise<void> {
    // Chained, so two saves from the same process cannot interleave their read and write.
    const next = this.#writing.then(() => this.#write(ref, material));
    this.#writing = next.catch(() => undefined);
    return next;
  }

  async #write(ref: string, material: Record<string, string>): Promise<void> {
    const file = await this.#read();
    const version = await this.#keys.currentVersion();
    const key = await this.#keyFor(version);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(ref, 'utf8'));
    const data = Buffer.concat([cipher.update(JSON.stringify(material), 'utf8'), cipher.final()]);

    const next: SealedFile = {
      format: FORMAT,
      entries: {
        ...file.entries,
        [ref]: {
          v: version,
          iv: iv.toString('base64'),
          tag: cipher.getAuthTag().toString('base64'),
          data: data.toString('base64'),
          updatedAt: new Date().toISOString(),
        },
      },
    };

    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(next), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.#path);
    this.#cache = null;
  }

  async #read(): Promise<SealedFile> {
    let info;
    try {
      info = await stat(this.#path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { format: FORMAT, entries: {} };
      }
      throw error;
    }

    // Re-read only when the file changed, so a provider call does not parse the file on
    // every request, and a save from the panel is seen by the next call that follows it.
    if (this.#cache && this.#cache.mtimeMs === info.mtimeMs && this.#cache.size === info.size) {
      return this.#cache.file;
    }

    let parsed: SealedFile;
    try {
      parsed = JSON.parse(await readFile(this.#path, 'utf8')) as SealedFile;
    } catch {
      // Named by its path, never by its contents.
      throw new NxError('NX-5001', {
        detail: `the sealed secret file at ${this.#path} is not readable`,
      });
    }
    if (parsed.format !== FORMAT || typeof parsed.entries !== 'object' || parsed.entries === null) {
      throw new NxError('NX-5001', {
        detail: `the sealed secret file at ${this.#path} has an unknown format`,
      });
    }

    this.#cache = { mtimeMs: info.mtimeMs, size: info.size, file: parsed };
    return parsed;
  }

  async #open(ref: string, entry: SealedEntry): Promise<Readonly<Record<string, string>>> {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        await this.#keyFor(entry.v),
        Buffer.from(entry.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(ref, 'utf8'));
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(entry.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(plain) as Record<string, string>;
    } catch {
      // A wrong key, a tampered entry and an entry moved under another reference all land
      // here, and all three get the same answer.
      throw new NxError('NX-5001', {
        detail: `the secret behind reference ${ref} could not be opened`,
      });
    }
  }

  async #keyFor(version: number): Promise<Buffer> {
    const root = await this.#keys.masterKey(version);
    return Buffer.from(hkdfSync('sha256', root, Buffer.from('nx-secret-store'), KEY_INFO, 32));
  }
}

/**
 * What a panel may know about a secret without reading it back.
 *
 * Which fields are set, when, and a short fingerprint of each value: enough for a person
 * to confirm that what they pasted yesterday is what is stored today, and nothing that
 * would help anyone recover it. Values that are identifiers rather than secrets are masked
 * instead, because a person recognises an application id by its ends.
 */
const NOT_SECRET = new Set(['clientId', 'appId', 'applicationId']);

export function describeMaterial(
  material: Readonly<Record<string, string>>,
  updatedAt: Date | null,
): SecretDescription {
  const fields: SecretDescription['fields'] = {};
  for (const [name, value] of Object.entries(material)) {
    fields[name] = NOT_SECRET.has(name)
      ? { masked: maskValue(value) }
      : { fingerprint: createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8) };
  }
  return { updatedAt, fields };
}

function maskValue(value: string): string {
  if (value.length <= 10) {
    return '…';
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Reads from several stores in order, and writes to the first that accepts writes.
 *
 * This is how a deployment moves from secrets in its environment to secrets the panel
 * manages without a flag day: references already in the environment keep resolving, and
 * each one saved from the panel lands in the sealed file and wins from then on.
 */
export class LayeredSecretStore implements SecretStore {
  readonly writable: boolean;
  readonly #stores: readonly SecretStore[];

  constructor(stores: readonly SecretStore[]) {
    if (stores.length === 0) {
      throw new Error('a layered secret store needs at least one store');
    }
    this.#stores = stores;
    this.writable = stores.some((store) => store.writable);
  }

  async fetch(ref: string): Promise<Readonly<Record<string, string>>> {
    let lastError: unknown = null;
    for (const store of this.#stores) {
      try {
        return await store.fetch(ref);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new NxError('NX-5001', { detail: `no secret stored for reference ${ref}` });
  }

  async describe(ref: string): Promise<SecretDescription | null> {
    for (const store of this.#stores) {
      const description = store.describe ? await store.describe(ref).catch(() => null) : null;
      if (description) {
        return description;
      }
    }
    return null;
  }

  put(ref: string, material: Record<string, string>): Promise<void> {
    const target = this.#stores.find((store) => store.writable && store.put);
    if (!target?.put) {
      return Promise.reject(
        new NxError('NX-4031', { detail: 'no store in this deployment accepts writes' }),
      );
    }
    return target.put(ref, material);
  }
}
