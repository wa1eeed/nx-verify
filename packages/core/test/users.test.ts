import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import {
  canApprove,
  canDecide,
  createSession,
  createUser,
  disableUser,
  getUser,
  listUsers,
  resolveSession,
  revokeSession,
  setUserRole,
} from '../src/auth/users.js';
import { readAudit } from '../src/auth/audit.js';
import { NxError } from '../src/errors.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';

/**
 * Users, roles and sessions.
 *
 * Before this, an actor was a string and four eyes compared two spellings. These tests
 * are about the difference between a name and an identity.
 */

describe('users, roles and sessions', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let adminId = '';

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Users Tenant');
    adminId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createUser(tx, { email: 'admin@example.sa', displayName: 'مدير', role: 'ADMIN' }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('separates the four roles the blueprint names', () => {
    expect(canDecide('VIEWER')).toBe(false);
    expect(canDecide('ANALYST')).toBe(true);
    // The separation that earns its keep: an analyst decides, and does not sign off.
    expect(canApprove('ANALYST')).toBe(false);
    expect(canApprove('APPROVER')).toBe(true);
    expect(canApprove('ADMIN')).toBe(true);
  });

  it('refuses two users with the same address in one tenant', async () => {
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        createUser(tx, { email: 'ADMIN@example.sa', displayName: 'مكرر', role: 'VIEWER' }),
      ),
      // Compared without case, because an address is not two addresses in different case.
    ).rejects.toBeInstanceOf(NxError);
  });

  it('lets the same address exist in a different tenant', async () => {
    const other = await seedTenant(db.appPool, 'Users Other Tenant');
    const id = await withTenant(db.appPool, other.tenantId, (tx) =>
      createUser(tx, { email: 'admin@example.sa', displayName: 'مدير آخر', role: 'ADMIN' }),
    );
    expect(id).toBeTruthy();

    const mine = await withTenant(db.appPool, tenant.tenantId, (tx) => listUsers(tx));
    expect(mine.map((user) => user.userId)).not.toContain(id);
  });

  it('issues a session that resolves to a person and a tenant', async () => {
    const session = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createSession(tx, { userId: adminId }),
    );

    expect(session.token.startsWith('nxs_')).toBe(true);

    // Resolved with no tenant in scope, because the session is what determines it.
    const resolved = await withoutTenant(db.appPool, (tx) => resolveSession(tx, session.token));
    expect(resolved?.tenantId).toBe(tenant.tenantId);
    expect(resolved?.userId).toBe(adminId);
    expect(resolved?.role).toBe('ADMIN');
  });

  it('stores only a hash of the session token', async () => {
    const session = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createSession(tx, { userId: adminId }),
    );

    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM user_sessions
           WHERE token_hash::text LIKE '%' || $1 || '%'
         ) AS present`,
        [session.token.slice(4, 20)],
      ),
    );
    // A stolen database yields no working session.
    expect(rows[0]?.present).toBe(false);
  });

  it('refuses a revoked session, and a token that is not one of ours', async () => {
    const session = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createSession(tx, { userId: adminId }),
    );
    await withTenant(db.appPool, tenant.tenantId, (tx) => revokeSession(tx, session.sessionId));

    expect(await withoutTenant(db.appPool, (tx) => resolveSession(tx, session.token))).toBeNull();
    expect(await withoutTenant(db.appPool, (tx) => resolveSession(tx, 'not-a-token'))).toBeNull();
  });

  it('refuses an expired session', async () => {
    const session = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const issued = await createSession(tx, { userId: adminId });
      await tx.query(
        `UPDATE user_sessions SET expires_at = now() - interval '1 hour' WHERE id = $1`,
        [issued.sessionId],
      );
      return issued;
    });

    expect(await withoutTenant(db.appPool, (tx) => resolveSession(tx, session.token))).toBeNull();
  });

  it('ends every session when a user is disabled', async () => {
    const userId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createUser(tx, { email: 'leaver@example.sa', displayName: 'مغادر', role: 'ANALYST' }),
    );
    const session = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createSession(tx, { userId }),
    );

    await withTenant(db.appPool, tenant.tenantId, (tx) => disableUser(tx, userId, adminId));

    // Disabling someone who is signed in has to end the session, or the account is
    // disabled everywhere except where it matters.
    expect(await withoutTenant(db.appPool, (tx) => resolveSession(tx, session.token))).toBeNull();
    expect(
      (await withTenant(db.appPool, tenant.tenantId, (tx) => getUser(tx, userId)))?.status,
    ).toBe('disabled');
  });

  it('records a role change, since it changes what a person may do', async () => {
    const userId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createUser(tx, { email: 'promoted@example.sa', displayName: 'مرقّى', role: 'ANALYST' }),
    );
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      setUserRole(tx, userId, 'APPROVER', adminId),
    );

    const entries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      readAudit(tx, { action: 'user.role_changed' }),
    );
    expect(entries[0]?.target).toBe(userId);
  });

  it('keeps one tenant users invisible to another', async () => {
    const other = await seedTenant(db.appPool, 'Users Third Tenant');
    const users = await withTenant(db.appPool, other.tenantId, (tx) => listUsers(tx));
    expect(users).toEqual([]);
  });
});
