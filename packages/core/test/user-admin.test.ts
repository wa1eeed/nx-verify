import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import {
  countActiveAdmins,
  createUser,
  disableUser,
  enableUser,
  listUsers,
  setUserRole,
} from '../src/auth/users.js';

/**
 * Unit 64 acceptance: a workspace can be administered by the people in it.
 *
 * The tests that matter are the two ways a workspace locks itself out, because neither
 * has a recovery the subscriber can run themselves: the last administrator stepping down,
 * and somebody disabling their own account.
 */

describe('administering a workspace', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let adminId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'People Tenant');
    adminId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createUser(tx, { email: 'admin@people.sa', displayName: 'مسؤول', role: 'ADMIN' }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('refuses to demote the only administrator', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      expect(await countActiveAdmins(tx)).toBe(1);
      await expect(setUserRole(tx, adminId, 'VIEWER', adminId)).rejects.toMatchObject({
        code: 'NX-4091',
      });
    });
  });

  it('refuses to disable the only administrator', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const other = await createUser(tx, {
        email: 'temp@people.sa',
        displayName: 'مؤقت',
        role: 'ANALYST',
      });
      await expect(disableUser(tx, adminId, other)).rejects.toMatchObject({ code: 'NX-4091' });
    });
  });

  it('refuses to let an account disable itself', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const analyst = await createUser(tx, {
        email: 'analyst@people.sa',
        displayName: 'محلل',
        role: 'ANALYST',
      });
      // Not the last administrator, so the only reason to refuse is that it is themselves.
      await expect(disableUser(tx, analyst, analyst)).rejects.toMatchObject({ code: 'NX-4091' });
    });
  });

  it('allows the handover once there are two administrators', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const second = await createUser(tx, {
        email: 'second@people.sa',
        displayName: 'مسؤولة ثانية',
        role: 'ADMIN',
      });
      expect(await countActiveAdmins(tx)).toBe(2);

      await setUserRole(tx, adminId, 'ANALYST', second);
      expect(await countActiveAdmins(tx)).toBe(1);

      // And now the remaining one is protected in turn.
      await expect(setUserRole(tx, second, 'VIEWER', second)).rejects.toMatchObject({
        code: 'NX-4091',
      });
    });
  });

  it('ends every session when an account is disabled, and does not restore them', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const person = await createUser(tx, {
        email: 'leaver@people.sa',
        displayName: 'مغادر',
        role: 'ANALYST',
      });
      const admin = await createUser(tx, {
        email: 'admin2@people.sa',
        displayName: 'مسؤول آخر',
        role: 'ADMIN',
      });

      await tx.query(
        `INSERT INTO user_sessions (tenant_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 day')`,
        [tx.tenantId, person, Buffer.alloc(32, 3)],
      );

      await disableUser(tx, person, admin);
      const revoked = await tx.query<{ revoked: string }>(
        `SELECT count(*)::text AS revoked FROM user_sessions
         WHERE user_id = $1 AND revoked_at IS NOT NULL`,
        [person],
      );
      expect(revoked.rows[0]?.revoked).toBe('1');

      await enableUser(tx, person, admin);
      const live = await tx.query<{ live: string }>(
        `SELECT count(*)::text AS live FROM user_sessions
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [person],
      );
      // Coming back is a new sign in. The session that was cut off stays cut off, because
      // the reason for cutting it may not have gone away on that device.
      expect(live.rows[0]?.live).toBe('0');

      const people = await listUsers(tx);
      expect(people.find((user) => user.userId === person)?.status).toBe('active');
    });
  });
});
