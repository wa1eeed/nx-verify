import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { setProviderConnection } from '../src/connections.js';
import { InMemorySecretStore, resolveCredential } from '../src/credentials.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';

/**
 * Unit 75 acceptance: every subscriber is served under the platform's own credential.
 *
 * Nobody brings a credential of their own any more (ADR-108). A subscriber with no binding
 * row uses the connection the administration panel set for their world, and the world is
 * decided by the workspace: a sandbox reaches the sandbox credential and cannot reach the
 * production one, whatever the request says.
 */

describe('the platform credential', () => {
  let db: TestDatabase;
  let live: SeededTenant;
  let sandbox: SeededTenant;
  const secrets = new InMemorySecretStore({
    'kms://providers/primary/live': { clientId: 'live-id', clientSecret: 'live-secret' },
    'kms://providers/primary/sandbox': { clientId: 'sandbox-id', clientSecret: 'sandbox-secret' },
    'kms://tenants/special/primary': { clientId: 'own-id', clientSecret: 'own-secret' },
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    live = await seedTenant(db.appPool, 'Live Subscriber');
    sandbox = await seedTenant(db.appPool, 'Live Subscriber (sandbox)');
    await db.operatorPool.query(`UPDATE tenants SET sandbox_of = $1 WHERE id = $2`, [
      live.tenantId,
      sandbox.tenantId,
    ]);

    await db.operatorPool.query(
      `INSERT INTO provider_catalog (code, name_ar, name_en, endpoints)
       VALUES ('primary', 'مصدر البيانات', 'Primary data source', '{business_verification}')
       ON CONFLICT (code) DO NOTHING`,
    );
    for (const environment of ['sandbox', 'live'] as const) {
      await setProviderConnection(
        db.operatorPool,
        {
          provider: 'primary',
          environment,
          kind: 'openbanking',
          baseUrl: `https://${environment}.example.com`,
          authUrl: `https://auth.${environment}.example.com/oauth2/token`,
          credentialRef: `kms://providers/primary/${environment}`,
        },
        'nx-staff:test',
      );
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('serves a production subscriber with no binding under the production credential', async () => {
    const credential = await withTenant(db.appPool, live.tenantId, (tx) =>
      resolveCredential(tx, secrets, 'primary'),
    );
    expect(credential.ref).toBe('kms://providers/primary/live');
    expect(credential.mode).toBe('MANAGED');
    expect(credential.material['clientSecret']).toBe('live-secret');
  });

  it('serves a sandbox under the sandbox credential and never the production one', async () => {
    const credential = await withTenant(db.appPool, sandbox.tenantId, (tx) =>
      resolveCredential(tx, secrets, 'primary'),
    );
    expect(credential.ref).toBe('kms://providers/primary/sandbox');
    expect(credential.material['clientSecret']).toBe('sandbox-secret');
  });

  it('still honours a binding that names its own reference', async () => {
    await withTenant(db.appPool, live.tenantId, (tx) =>
      tx.query(
        `INSERT INTO tenant_provider_binding (tenant_id, provider, mode, credential_ref, activated_at)
         VALUES ($1, 'primary', 'MANAGED', 'kms://tenants/special/primary', now())`,
        [tx.tenantId],
      ),
    );
    const credential = await withTenant(db.appPool, live.tenantId, (tx) =>
      resolveCredential(tx, secrets, 'primary'),
    );
    expect(credential.ref).toBe('kms://tenants/special/primary');
  });

  it('says there is no binding when the platform has no connection either', async () => {
    await expect(
      withTenant(db.appPool, sandbox.tenantId, (tx) =>
        resolveCredential(tx, secrets, 'unconnected'),
      ),
    ).rejects.toMatchObject({ code: 'NX-4041' });
  });

  it('keeps only the reference in the database, never the material', async () => {
    const { rows } = await db.operatorPool.query<{ row: string }>(
      `SELECT row_to_json(c)::text AS row FROM provider_connections c`,
    );
    // The material values themselves, not the word: a column may be called callback_secret_ref.
    const material = ['live-secret', 'sandbox-secret', 'live-id', 'sandbox-id'];
    for (const { row } of rows) {
      for (const value of material) {
        expect(row).not.toContain(value);
      }
      expect(row).toContain('kms://');
    }
    const { rows: trail } = await db.operatorPool.query<{ metadata: string }>(
      `SELECT metadata::text FROM operator_audit`,
    );
    expect(trail.length).toBeGreaterThanOrEqual(2);
    for (const entry of trail) {
      for (const value of material) {
        expect(entry.metadata).not.toContain(value);
      }
    }
  });
});
