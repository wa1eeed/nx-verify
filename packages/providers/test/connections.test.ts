import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  listProviderConnections,
  registryFor,
  setProviderConnection,
} from '../src/connections.js';
import { InMemorySecretStore, EnvSecretStore } from '../src/credentials.js';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * Unit 58 acceptance: a provider is connected from the panel, per environment.
 *
 * The address changes on a supplier's timetable rather than ours, so it lives in a table
 * an operator edits. The credential does not live there at all, and the store says
 * plainly whether it can be written to rather than appearing to save.
 */

describe('provider connections', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.operatorPool.query(
      `INSERT INTO provider_catalog (code, name_ar, name_en, endpoints)
       VALUES ('bankdata', 'بيانات مصرفية', 'Bank data', '{bank_account_ownership}')
       ON CONFLICT (code) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('keeps the two environments apart, with their own addresses', async () => {
    await setProviderConnection(
      db.operatorPool,
      {
        provider: 'bankdata',
        environment: 'sandbox',
        kind: 'openbanking',
        baseUrl: 'https://sandbox.example.com',
        authUrl: 'https://auth.sandbox.example.com/oauth2/token',
        credentialRef: 'kms://providers/bankdata/sandbox',
      },
      'nx-staff:test',
    );

    await setProviderConnection(
      db.operatorPool,
      {
        provider: 'bankdata',
        environment: 'live',
        kind: 'openbanking',
        baseUrl: 'https://api.example.com',
        authUrl: 'https://auth.example.com/oauth2/token',
        credentialRef: 'kms://providers/bankdata/live',
      },
      'nx-staff:test',
    );

    const connections = await listProviderConnections(db.operatorPool);
    const sandbox = connections.find((row) => row.environment === 'sandbox');
    const live = connections.find((row) => row.environment === 'live');

    // A platform that cannot tell the two apart will one day check a real company against
    // a test service.
    expect(sandbox?.baseUrl).toBe('https://sandbox.example.com');
    expect(live?.baseUrl).toBe('https://api.example.com');
    expect(sandbox?.credentialRef).not.toBe(live?.credentialRef);
  });

  it('builds the registry for the world the caller is in', async () => {
    const sandbox = await registryFor(db.operatorPool, 'sandbox');
    const live = await registryFor(db.operatorPool, 'live');

    expect(sandbox.names()).toContain('bankdata');
    expect(live.names()).toContain('bankdata');
  });

  it('falls back to the environment when the table says nothing', async () => {
    const empty = await registryFor(db.operatorPool, 'sandbox', { NX_PROVIDERS: 'stub' });
    // The rows exist for this environment, so they win: somebody set them on purpose.
    expect(empty.names()).toContain('bankdata');

    await db.operatorPool.query(`UPDATE provider_connections SET status = 'disabled'`);
    const fallback = await registryFor(db.operatorPool, 'sandbox', { NX_PROVIDERS: 'stub' });
    // With nothing active, a deployment that has not used the panel keeps working.
    expect(fallback.names()).toEqual(['stub']);
    await db.operatorPool.query(`UPDATE provider_connections SET status = 'active'`);
  });

  it('refuses a credential reference that is not a pointer', async () => {
    await expect(
      setProviderConnection(
        db.operatorPool,
        {
          provider: 'bankdata',
          environment: 'sandbox',
          kind: 'http',
          baseUrl: 'https://sandbox.example.com',
          // The material itself, which is exactly what rule 10 forbids in a row.
          credentialRef: 'super-secret-value',
        },
        'nx-staff:test',
      ),
    ).rejects.toThrow();
  });

  it('writes a secret to the store and never to a row', async () => {
    const store = new InMemorySecretStore();
    await store.put?.('kms://providers/bankdata/sandbox', { clientSecret: 'the-secret' });

    const material = await store.fetch('kms://providers/bankdata/sandbox');
    expect(material['clientSecret']).toBe('the-secret');

    const { rows } = await db.operatorPool.query<{ count: string }>(
      `SELECT count(*)::text FROM provider_connections WHERE credential_ref LIKE '%the-secret%'`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('says plainly when the deployment cannot be written to', async () => {
    const store = new EnvSecretStore();
    // Half working is worse than refusing: the panel prints the line to set instead. The
    // material is not passed here because this store refuses before looking at it.
    await expect(store.put?.('kms://providers/bankdata/sandbox')).rejects.toThrow(/cannot write/);
  });
});
