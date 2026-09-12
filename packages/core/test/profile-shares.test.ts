import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import {
  createTestDatabase,
  seedEntity,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import type { FieldGroup } from '../src/profile/field-catalogue.js';
import {
  createShare,
  hashShareToken,
  listShares,
  recordShareView,
  resolveShare,
  revokeShare,
} from '../src/profile/shares.js';

/**
 * Unit 63 acceptance: a profile can be shown to someone with no account, and taken back.
 *
 * The tests that matter are the ones that try to get something the link was not meant to
 * give: a revoked link, an expired one, a guessed one, and the token itself out of the
 * database.
 */

describe('a shared profile', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let otherTenant: SeededTenant;
  let entityId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Sharing Tenant');
    otherTenant = await seedTenant(db.appPool, 'Other Tenant');
    entityId = tenant.entityId;
  });

  afterAll(async () => {
    await db.close();
  });

  const issue = (groups: FieldGroup[] = ['REGISTRY'], ttlDays = 30) =>
    withTenant(db.appPool, tenant.tenantId, (tx) =>
      createShare(tx, { entityId, groups, ttlDays, purpose: 'فتح حساب' }),
    );

  it('never stores the token, only a hash of it', async () => {
    const share = await issue();

    const stored = await withTenant(db.migratorPool, tenant.tenantId, async (tx) => {
      const hit = await tx.query<{ hit: string }>(
        `SELECT count(*)::text AS hit FROM profile_shares
         WHERE token_hash::text LIKE $1 OR coalesce(purpose, '') LIKE $1`,
        [`%${share.token}%`],
      );
      expect(hit.rows[0]?.hit).toBe('0');

      const row = await tx.query<{ token_hash: Buffer }>(
        `SELECT token_hash FROM profile_shares WHERE id = $1`,
        [share.shareId],
      );
      return row.rows[0];
    });

    // The hash it does hold is the one the resolver computes, so a leaked backup opens
    // nothing without the link itself.
    expect(stored?.token_hash.equals(hashShareToken(share.token))).toBe(true);
  });

  it('opens for a reader with no account, and names the workspace and entity', async () => {
    const share = await issue();
    const resolved = await withoutTenant(db.appPool, (tx) => resolveShare(tx, share.token));
    expect(resolved).toMatchObject({
      tenantId: tenant.tenantId,
      entityId,
      groups: ['REGISTRY'],
    });
  });

  it('opens nothing once it is withdrawn', async () => {
    const share = await issue();
    await withTenant(db.appPool, tenant.tenantId, (tx) => revokeShare(tx, share.shareId));

    const resolved = await withoutTenant(db.appPool, (tx) => resolveShare(tx, share.token));
    // Refused by the database rather than by the screen, so a page that forgets to check
    // cannot publish one.
    expect(resolved).toBeNull();
  });

  it('opens nothing once it has expired', async () => {
    const share = await issue();
    await withTenant(db.migratorPool, tenant.tenantId, (tx) =>
      tx.query(`UPDATE profile_shares SET expires_at = now() - interval '1 day' WHERE id = $1`, [
        share.shareId,
      ]),
    );
    expect(await withoutTenant(db.appPool, (tx) => resolveShare(tx, share.token))).toBeNull();
  });

  it('opens nothing for a guessed link', async () => {
    expect(
      await withoutTenant(db.appPool, (tx) => resolveShare(tx, 'not-a-real-token')),
    ).toBeNull();
  });

  it('refuses a share that opens nothing, and one that never ends', async () => {
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        createShare(tx, { entityId, groups: [], ttlDays: 30 }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4001' });

    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        createShare(tx, { entityId, groups: ['REGISTRY'], ttlDays: 4000 }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4001' });
  });

  it('keeps one workspace share invisible to another', async () => {
    await issue();
    const seen = await withTenant(db.appPool, otherTenant.tenantId, (tx) =>
      listShares(tx, entityId),
    );
    expect(seen).toHaveLength(0);
  });

  it('counts that it was opened, and nothing about who opened it', async () => {
    const share = await issue();
    await withTenant(db.appPool, tenant.tenantId, (tx) => recordShareView(tx, share.shareId));
    await withTenant(db.appPool, tenant.tenantId, (tx) => recordShareView(tx, share.shareId));

    const listed = await withTenant(db.appPool, tenant.tenantId, (tx) => listShares(tx, entityId));
    const row = listed.find((item) => item.shareId === share.shareId);
    expect(row?.viewCount).toBe(2);
    expect(row?.lastViewedAt).toBeInstanceOf(Date);
    expect(row?.state).toBe('live');

    // There is no column for the reader. Accountability, not surveillance.
    const { rows: columns } = await db.migratorPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'profile_shares'`,
    );
    const names = columns.map((column) => column.column_name);
    expect(names).not.toContain('viewer_ip');
    expect(names).not.toContain('user_agent');
  });

  it('lets an entity be shared to more than one reader, separately revocable', async () => {
    const bank = await issue(['REGISTRY']);
    const marketplace = await issue(['ADDRESS']);

    await withTenant(db.appPool, tenant.tenantId, (tx) => revokeShare(tx, bank.shareId));

    expect(await withoutTenant(db.appPool, (tx) => resolveShare(tx, bank.token))).toBeNull();
    expect(
      await withoutTenant(db.appPool, (tx) => resolveShare(tx, marketplace.token)),
    ).not.toBeNull();
  });

  it('never opens another entity in the same workspace', async () => {
    const neighbour = await seedEntity(db.appPool, tenant.tenantId, 'BUSINESS', 'جارة');
    const share = await issue();
    const resolved = await withoutTenant(db.appPool, (tx) => resolveShare(tx, share.token));
    expect(resolved?.entityId).toBe(entityId);
    expect(resolved?.entityId).not.toBe(neighbour);
  });
});
