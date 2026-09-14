import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StaticMasterKeySource } from '@nx-verify/core';
import { LayeredSecretStore, SealedFileSecretStore } from '../src/sealed-store.js';
import { EnvSecretStore, secretStoreFromEnv } from '../src/credentials.js';

/**
 * Unit 75 acceptance: the panel can hold the data source credentials, and the database
 * never does.
 *
 * What these prove is what makes the file acceptable as a home for a secret: it is
 * ciphertext on its own, an entry cannot be moved to another reference, the wrong key
 * opens nothing, and a rotated master key leaves yesterday's entries readable.
 */

const SECRET = 'a-client-secret-nobody-should-see-9f3e';
const CLIENT_ID = 'fd62a5f8-2be1-44b4-b1e5-27222c2c8ffe';

describe('the sealed secret file', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nx-sealed-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const keys = (seed = 7) => new StaticMasterKeySource(Buffer.alloc(32, seed));

  it('gives back what was put, and the file holds none of it in the clear', async () => {
    const path = join(dir, 'roundtrip.sealed');
    const store = new SealedFileSecretStore({ path, keys: keys() });

    await store.put('kms://providers/primary/sandbox', {
      clientId: CLIENT_ID,
      clientSecret: SECRET,
    });
    expect(await store.fetch('kms://providers/primary/sandbox')).toEqual({
      clientId: CLIENT_ID,
      clientSecret: SECRET,
    });

    const onDisk = await readFile(path, 'utf8');
    expect(onDisk).not.toContain(SECRET);
    expect(onDisk).not.toContain(CLIENT_ID);
    // The reference is named in the file, which is fine: it is what the database holds.
    expect(onDisk).toContain('kms://providers/primary/sandbox');
  });

  it('is readable by its owner alone', async () => {
    const path = join(dir, 'mode.sealed');
    await new SealedFileSecretStore({ path, keys: keys() }).put('kms://x', {
      clientSecret: SECRET,
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('refuses an entry copied under another reference', async () => {
    const path = join(dir, 'swap.sealed');
    const store = new SealedFileSecretStore({ path, keys: keys() });
    await store.put('kms://providers/primary/sandbox', { clientSecret: 'sandbox-secret' });

    // Somebody with write access to the file moves the sandbox entry under the live name.
    const file = JSON.parse(await readFile(path, 'utf8')) as {
      entries: Record<string, unknown>;
    };
    file.entries['kms://providers/primary/live'] = file.entries['kms://providers/primary/sandbox'];
    await writeFile(path, JSON.stringify(file));

    const reopened = new SealedFileSecretStore({ path, keys: keys() });
    await expect(reopened.fetch('kms://providers/primary/live')).rejects.toMatchObject({
      code: 'NX-5001',
    });
    await expect(reopened.fetch('kms://providers/primary/sandbox')).resolves.toEqual({
      clientSecret: 'sandbox-secret',
    });
  });

  it('opens nothing with the wrong master key, and says so without the material', async () => {
    const path = join(dir, 'wrong-key.sealed');
    await new SealedFileSecretStore({ path, keys: keys(7) }).put('kms://y', {
      clientSecret: SECRET,
    });

    const error = await new SealedFileSecretStore({ path, keys: keys(9) })
      .fetch('kms://y')
      .catch((caught: unknown) => caught as Error);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain(SECRET);
  });

  it('keeps entries sealed under an older key version readable after a rotation', async () => {
    const path = join(dir, 'rotation.sealed');
    const v1 = new StaticMasterKeySource(new Map([[1, Buffer.alloc(32, 1)]]));
    await new SealedFileSecretStore({ path, keys: v1 }).put('kms://old', { clientSecret: 'old' });

    const both = new StaticMasterKeySource(
      new Map([
        [1, Buffer.alloc(32, 1)],
        [2, Buffer.alloc(32, 2)],
      ]),
    );
    const rotated = new SealedFileSecretStore({ path, keys: both });
    await rotated.put('kms://new', { clientSecret: 'new' });

    expect(await rotated.fetch('kms://old')).toEqual({ clientSecret: 'old' });
    const file = JSON.parse(await readFile(path, 'utf8')) as {
      entries: Record<string, { v: number }>;
    };
    expect(file.entries['kms://old']?.v).toBe(1);
    expect(file.entries['kms://new']?.v).toBe(2);
  });

  it('describes a secret by fingerprint and an identifier by its ends, and returns neither', async () => {
    const path = join(dir, 'describe.sealed');
    const store = new SealedFileSecretStore({ path, keys: keys() });
    await store.put('kms://d', { clientId: CLIENT_ID, clientSecret: SECRET });

    const description = await store.describe('kms://d');
    expect(description?.updatedAt).toBeInstanceOf(Date);
    expect(description?.fields['clientSecret']?.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(description?.fields['clientId']?.masked).toBe('fd62a5…8ffe');
    expect(JSON.stringify(description)).not.toContain(SECRET);
    expect(await store.describe('kms://absent')).toBeNull();
  });

  it('moves a deployment off its environment without a flag day', async () => {
    const path = join(dir, 'layered.sealed');
    const previous = process.env['NX_SECRETS_LAYERED_TEST'];
    process.env['NX_SECRETS_LAYERED_TEST'] = JSON.stringify({
      'kms://legacy': { apiKey: 'from-env' },
    });

    try {
      const store = new LayeredSecretStore([
        new SealedFileSecretStore({ path, keys: keys() }),
        new EnvSecretStore('NX_SECRETS_LAYERED_TEST'),
      ]);
      expect(store.writable).toBe(true);
      expect(await store.fetch('kms://legacy')).toEqual({ apiKey: 'from-env' });

      await store.put('kms://legacy', { apiKey: 'from-panel' });
      expect(await store.fetch('kms://legacy')).toEqual({ apiKey: 'from-panel' });
    } finally {
      if (previous === undefined) {
        delete process.env['NX_SECRETS_LAYERED_TEST'];
      } else {
        process.env['NX_SECRETS_LAYERED_TEST'] = previous;
      }
    }
  });

  it('is what a deployment gets when it names a sealed file, production included', () => {
    const store = secretStoreFromEnv({
      NODE_ENV: 'development',
      NX_SECRETS_FILE: join(dir, 'env.sealed'),
      NX_MASTER_KEY: Buffer.alloc(32, 3).toString('base64'),
    });
    expect(store.writable).toBe(true);
    expect(store).toBeInstanceOf(SealedFileSecretStore);

    expect(() => secretStoreFromEnv({ NODE_ENV: 'production' })).toThrow(/NX_SECRETS_FILE/);
  });
});
