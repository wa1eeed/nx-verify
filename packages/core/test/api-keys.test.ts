import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { issueApiKey, listApiKeys, revokeApiKey } from '../src/auth/api-keys.js';
import { readAudit } from '../src/auth/audit.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';

/**
 * Issuing and ending the credentials that spend a workspace's balance.
 *
 * The console's trail carried labels for «apikey.issued» and «apikey.revoked» from the day it
 * was written, and neither function ever wrote one (ADR-150). A key that can run verifications
 * against a customer's wallet appeared out of nowhere, and stopped working out of nowhere, with
 * nothing in the log either way.
 */

/** The number of characters of a key that are safe to keep, and the rest that are not. */
const PREFIX_LENGTH = 12;

describe('the trail of an API key', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Keys Tenant');
  });

  afterAll(async () => {
    await db.close();
  });

  const entries = (action: string) =>
    withTenant(db.appPool, tenant.tenantId, (tx) => readAudit(tx, { action }));

  it('records who issued a key, against the key it issued', async () => {
    const actorId = '11111111-1111-1111-1111-111111111111';
    const issued = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      issueApiKey(tx, { name: 'billing system', scopes: ['products:read'] }, actorId),
    );

    const [entry] = await entries('apikey.issued');
    expect(entry?.target).toBe(issued.id);
    expect(entry?.actorId).toBe(actorId);
    expect(entry?.actorType).toBe('USER');
    expect(entry?.metadata).toMatchObject({
      name: 'billing system',
      environment: 'live',
      scopes: ['products:read'],
      key_prefix: issued.prefix,
    });
  });

  it('keeps the secret and its hash out of the entry', async () => {
    const issued = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      issueApiKey(tx, { name: 'never logged' }),
    );

    // The whole point of storing a hash is that a leaked line yields no working key. An audit
    // row carrying either would hand back what the table itself refuses to keep.
    const written = JSON.stringify(await entries('apikey.issued'));
    expect(written).not.toContain(issued.secret);
    expect(written).not.toContain(issued.secret.slice(PREFIX_LENGTH));
    expect(written).not.toContain('key_hash');
    // The prefix is the one part that is safe, and is what ties the row to the console.
    expect(written).toContain(issued.prefix);
  });

  it('names the deployment itself when nobody is acting', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) => issueApiKey(tx, { name: 'provisioned' }));
    const [entry] = await entries('apikey.issued');
    expect(entry?.actorId).toBe('system');
  });

  it('records a revocation, and which key stopped working', async () => {
    const actorId = '22222222-2222-2222-2222-222222222222';
    const issued = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      issueApiKey(tx, { name: 'to be revoked' }),
    );

    await withTenant(db.appPool, tenant.tenantId, (tx) => revokeApiKey(tx, issued.id, actorId));

    const [entry] = await entries('apikey.revoked');
    expect(entry?.target).toBe(issued.id);
    expect(entry?.actorId).toBe(actorId);
    expect(entry?.metadata).toMatchObject({
      key_prefix: issued.prefix,
      environment: 'live',
    });

    const keys = await withTenant(db.appPool, tenant.tenantId, (tx) => listApiKeys(tx));
    expect(keys.find((key) => key.id === issued.id)?.revokedAt).not.toBeNull();
  });

  it('writes nothing when nothing was revoked', async () => {
    const issued = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      issueApiKey(tx, { name: 'revoked once' }),
    );
    await withTenant(db.appPool, tenant.tenantId, (tx) => revokeApiKey(tx, issued.id));

    const before = (await entries('apikey.revoked')).length;
    await withTenant(db.appPool, tenant.tenantId, (tx) => revokeApiKey(tx, issued.id));
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      revokeApiKey(tx, '33333333-3333-3333-3333-333333333333'),
    );

    // A second press, and a key id from somewhere else, would each otherwise leave an entry
    // saying a revocation happened at a moment when none did.
    expect((await entries('apikey.revoked')).length).toBe(before);
  });

  it('cannot end a key belonging to another workspace, nor write into their trail', async () => {
    const other = await seedTenant(db.appPool, 'Other Keys Tenant');
    const theirs = await withTenant(db.appPool, other.tenantId, (tx) =>
      issueApiKey(tx, { name: 'theirs' }),
    );

    await withTenant(db.appPool, tenant.tenantId, (tx) => revokeApiKey(tx, theirs.id));

    const stillActive = await withTenant(db.appPool, other.tenantId, (tx) => listApiKeys(tx));
    expect(stillActive.find((key) => key.id === theirs.id)?.revokedAt).toBeNull();

    const theirTrail = await withTenant(db.appPool, other.tenantId, (tx) =>
      readAudit(tx, { action: 'apikey.revoked' }),
    );
    expect(theirTrail).toHaveLength(0);
  });
});
