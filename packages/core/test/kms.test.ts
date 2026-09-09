import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { HttpKmsClient, KmsMasterKeySource, type Fetcher } from '../src/crypto/kms.js';
import { DerivedTenantKeyProvider } from '../src/crypto/tenant-keys.js';
import { HttpSecretStore } from '../../providers/src/credentials.js';

/**
 * Unit 31 acceptance: the key material comes from a service, and nothing about it leaks.
 *
 * A managed key service never hands out the root key, it decrypts on request, so what a
 * deployment stores is an encrypted data key. These tests drive that shape against a
 * service that answers like one, and check the two things that matter: the plaintext is
 * never in an error, and it is not fetched again for every identifier.
 */

const ROOT = randomBytes(32);
const CIPHERTEXT = 'ciphertext-for-version-1';

interface FakeService {
  fetcher: Fetcher;
  /** How many times the service was actually called. */
  calls: () => number;
}

function serviceThat(answers: {
  status?: number;
  plaintext?: string;
  onCall?: (body: unknown) => void;
}): FakeService {
  let calls = 0;
  const fetcher: Fetcher = (_url, init) => {
    calls += 1;
    answers.onCall?.(JSON.parse(init.body));
    return Promise.resolve({
      status: answers.status ?? 200,
      json: () => Promise.resolve({ plaintext: answers.plaintext ?? ROOT.toString('base64') }),
    });
  };
  return { fetcher, calls: () => calls };
}

describe('the key management source', () => {
  const build = (fetcher: Fetcher, options: { cacheSeconds?: number; now?: () => number } = {}) =>
    new KmsMasterKeySource({
      endpoint: 'https://kms.example.com/decrypt',
      token: 'service-token',
      ciphertexts: { 1: CIPHERTEXT, 2: 'ciphertext-for-version-2' },
      currentVersion: 1,
      client: new HttpKmsClient('https://kms.example.com/decrypt', 'service-token', fetcher),
      ...options,
    });

  it('asks the service to decrypt the stored data key', async () => {
    let sent: unknown = null;
    const service = serviceThat({ onCall: (body) => (sent = body) });
    const source = build(service.fetcher);

    const key = await source.masterKey(1);
    expect(key.equals(ROOT)).toBe(true);
    // What travels is the ciphertext, which is useless to anyone who cannot call the
    // service. That is the whole point of storing it in configuration.
    expect(sent).toEqual({ ciphertext: CIPHERTEXT, key_version: 1 });
  });

  it('keeps several versions readable and writes with one', async () => {
    const source = build(serviceThat({}).fetcher);
    expect(await source.currentVersion()).toBe(1);
    expect(await source.availableVersions()).toEqual([1, 2]);
    // A version nobody configured is named in the error, and nothing else is.
    await expect(source.masterKey(9)).rejects.toThrow(/version 9/);
  });

  it('reuses a decrypted key briefly rather than calling per identifier', async () => {
    let clock = 1_000_000;
    const service = serviceThat({});
    const source = build(service.fetcher, { cacheSeconds: 60, now: () => clock });

    await source.masterKey(1);
    await source.masterKey(1);
    expect(service.calls()).toBe(1);

    clock += 61_000;
    await source.masterKey(1);
    expect(service.calls()).toBe(2);

    // And a rotation that retires a version drops what was held for it.
    source.forget(1);
    await source.masterKey(1);
    expect(service.calls()).toBe(3);
  });

  it('says the status and the version when the service refuses, and nothing else', async () => {
    const source = build(serviceThat({ status: 503 }).fetcher);
    const error = await source.masterKey(1).catch((thrown: Error) => thrown);

    expect(String(error)).toContain('503');
    expect(String(error)).toContain('version 1');
    // A service that echoed its input back would otherwise put a ciphertext, and one
    // that misbehaved could put a key, into our logs.
    expect(String(error)).not.toContain(CIPHERTEXT);
    expect(String(error)).not.toContain(ROOT.toString('base64'));
  });

  it('refuses a key that is too short to be one', async () => {
    const source = build(serviceThat({ plaintext: Buffer.alloc(8).toString('base64') }).fetcher);
    await expect(source.masterKey(1)).rejects.toThrow(/fewer than 32 bytes/);
  });

  it('drives the tenant key derivation the environment source drives', async () => {
    const source = build(serviceThat({}).fetcher);
    const keys = new DerivedTenantKeyProvider(source);
    const tenant = '3f2b0000-0000-4000-8000-000000000001';

    const lookup = await keys.hmacKey(tenant);
    const display = await keys.encryptionKey(tenant);
    // The same properties the derived provider always had: per tenant, per purpose, and
    // never the root key itself.
    expect(lookup.equals(display)).toBe(false);
    expect(lookup.equals(ROOT)).toBe(false);
    expect(lookup.length).toBeGreaterThanOrEqual(32);
  });

  it('reads its configuration from the environment, ciphertexts and all', () => {
    const source = KmsMasterKeySource.fromEnv({
      NX_KMS_ENDPOINT: 'https://kms.example.com/decrypt',
      NX_KMS_TOKEN: 'service-token',
      NX_KMS_KEYS: '1:first-ciphertext,2:second-ciphertext',
    });
    expect(source).toBeInstanceOf(KmsMasterKeySource);

    expect(() =>
      KmsMasterKeySource.fromEnv({ NX_KMS_ENDPOINT: 'https://kms.example.com' }),
    ).toThrow(/required/);
  });
});

describe('the secret manager store', () => {
  it('turns a reference into material, and holds it briefly', async () => {
    let clock = 1_000_000;
    let calls = 0;
    const store = new HttpSecretStore({
      endpoint: 'https://secrets.example.com/v1',
      token: 'service-token',
      cacheSeconds: 30,
      now: () => clock,
      fetcher: (url) => {
        calls += 1;
        expect(url).toContain(encodeURIComponent('kms://tenants/acme/idp'));
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ material: { clientSecret: 'the-secret' } }),
        });
      },
    });

    expect((await store.fetch('kms://tenants/acme/idp'))['clientSecret']).toBe('the-secret');
    await store.fetch('kms://tenants/acme/idp');
    expect(calls).toBe(1);

    // Not held past a rotation.
    clock += 31_000;
    await store.fetch('kms://tenants/acme/idp');
    expect(calls).toBe(2);
  });

  it('names the reference when it fails, and never the material', async () => {
    const store = new HttpSecretStore({
      endpoint: 'https://secrets.example.com/v1',
      token: 'service-token',
      fetcher: () =>
        Promise.resolve({
          status: 403,
          json: () => Promise.resolve({ material: { clientSecret: 'the-secret' } }),
        }),
    });

    const error = await store.fetch('kms://tenants/acme/idp').catch((thrown: Error) => thrown);
    expect(String(error)).toContain('kms://tenants/acme/idp');
    expect(String(error)).toContain('403');
    expect(String(error)).not.toContain('the-secret');
  });
});
