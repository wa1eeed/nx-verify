import { afterEach, describe, expect, it } from 'vitest';
import { EnvSecretStore, HttpSecretStore, type SecretFetcher } from '../src/credentials.js';

/**
 * «There is nothing under this reference» and «I could not ask» are two answers (ADR-179).
 *
 * Both stores used to catch their own failures inside describe and return null, which is the
 * shape of «nothing is stored here». The panel then told a member of staff that a credential
 * was missing whenever the secret manager was unreachable, whenever NX_SECRETS did not parse,
 * and whenever a key had rotated out from under an entry. The distinction has to hold in the
 * store, because a screen cannot recover a difference the store has already thrown away.
 */

const VARIABLE = 'NX_SECRETS_ANSWERS_TEST';

const fetcherFor =
  (status: number, body: unknown = {}): SecretFetcher =>
  (): ReturnType<SecretFetcher> =>
    Promise.resolve({ status, json: () => Promise.resolve(body) });

const httpStore = (fetcher: SecretFetcher): HttpSecretStore =>
  new HttpSecretStore({ endpoint: 'https://secrets.test/v1', token: 'token', fetcher });

afterEach(() => {
  // The literal, because `delete` on a computed key is refused by the lint rules, and setting
  // it to undefined would leave the string «undefined» in the environment.
  delete process.env['NX_SECRETS_ANSWERS_TEST'];
});

describe('EnvSecretStore tells an absent reference from an unreadable variable', () => {
  it('answers null for a reference the variable does not carry', async () => {
    process.env[VARIABLE] = JSON.stringify({ 'kms://tenants/a/idp': { apiKey: 'secret-value' } });
    const store = new EnvSecretStore(VARIABLE);

    expect(await store.describe('kms://tenants/a/absent')).toBeNull();
  });

  it('describes what it does carry by fingerprint, and returns no material', async () => {
    process.env[VARIABLE] = JSON.stringify({
      'kms://tenants/a/idp': { clientId: 'application-id-1234', clientSecret: 'secret-value' },
    });
    const store = new EnvSecretStore(VARIABLE);

    const description = await store.describe('kms://tenants/a/idp');
    expect(description?.fields['clientSecret']?.fingerprint).toHaveLength(8);
    // An identifier is masked and a secret is never anything but a fingerprint (rule 10).
    expect(description?.fields['clientId']?.masked).toContain('…');
    expect(JSON.stringify(description)).not.toContain('secret-value');
    expect(JSON.stringify(description)).not.toContain('application-id-1234');
  });

  it('raises rather than answering null when the variable is not set', async () => {
    const store = new EnvSecretStore(VARIABLE);

    // Rejects, and is not a synchronous throw: a caller that wrote `.catch` around it must be
    // able to catch it there.
    await expect(store.describe('kms://tenants/a/idp')).rejects.toThrow(VARIABLE);
  });

  it('rejects from fetch rather than throwing before it returns a promise', async () => {
    const store = new EnvSecretStore(VARIABLE);

    // The worker's mail job, the SSO action and the integration action all write
    // `store.fetch(ref).catch(...)`. A synchronous throw walks straight past that catch and
    // takes the caller down, so the failure has to arrive as a rejection.
    let thrownSynchronously = false;
    const caught = await (() => {
      try {
        return store.fetch('kms://tenants/a/idp').catch(() => null);
      } catch {
        thrownSynchronously = true;
        return Promise.resolve('escaped' as const);
      }
    })();

    expect(thrownSynchronously).toBe(false);
    expect(caught).toBeNull();
  });

  it('raises rather than answering null when the variable does not parse', async () => {
    process.env[VARIABLE] = '{ this is not json';
    const store = new EnvSecretStore(VARIABLE);

    await expect(store.describe('kms://tenants/a/idp')).rejects.toThrow('NX-5001');
    // The message names the variable and never its contents.
    await expect(store.describe('kms://tenants/a/idp')).rejects.not.toThrow('this is not json');
  });
});

describe('HttpSecretStore tells an empty reference from a manager that did not answer', () => {
  it('answers null when the manager says there is nothing under the reference', async () => {
    expect(await httpStore(fetcherFor(404)).describe('kms://tenants/a/idp')).toBeNull();
    // A body with no material is the same answer said another way.
    expect(await httpStore(fetcherFor(200, {})).describe('kms://tenants/a/idp')).toBeNull();
  });

  it('raises when the manager is unavailable, and carries the retryable code', async () => {
    const store = httpStore(fetcherFor(503));

    await expect(store.describe('kms://tenants/a/idp')).rejects.toThrow('NX-5002');
    await expect(store.describe('kms://tenants/a/idp')).rejects.toThrow('503');
  });

  it('raises when the manager refuses our token, which is not an empty reference either', async () => {
    await expect(httpStore(fetcherFor(403)).describe('kms://tenants/a/idp')).rejects.toThrow(
      'NX-5002',
    );
  });

  it('describes by fingerprint and lets no value out of the store', async () => {
    const store = httpStore(fetcherFor(200, { material: { apiKey: 'secret-value' } }));

    const description = await store.describe('kms://tenants/a/idp');
    expect(description?.fields['apiKey']?.fingerprint).toHaveLength(8);
    expect(JSON.stringify(description)).not.toContain('secret-value');
  });

  it('fetches a reference the manager has nothing under as an error that is not retryable', async () => {
    // NX-5001 rather than NX-5002: a reference with nothing behind it is not a service that is
    // temporarily unavailable, and retrying it retries forever.
    await expect(httpStore(fetcherFor(404)).fetch('kms://tenants/a/idp')).rejects.toThrow(
      'NX-5001',
    );
  });
});
