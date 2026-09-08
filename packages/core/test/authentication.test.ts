import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { createUser, resolveSession } from '../src/auth/users.js';
import {
  assertPasswordAcceptable,
  changeOwnPassword,
  login,
  setPassword,
} from '../src/auth/passwords.js';
import { readAudit } from '../src/auth/audit.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';

/**
 * Signing in.
 *
 * Most of these are about what a login must not reveal. A login form is the most probed
 * surface a platform has, and the questions an attacker asks it are: does this address
 * exist here, and can I keep guessing.
 */

const PASSWORD = 'correct horse battery staple';
const SLUG = 'auth-tenant';

describe('authentication', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let userId = '';

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Auth Tenant');

    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await tx.query(`UPDATE tenants SET slug = $2 WHERE id = $1`, [tenant.tenantId, SLUG]);
      userId = await createUser(tx, {
        email: 'analyst@auth.sa',
        displayName: 'محلل',
        role: 'ANALYST',
      });
      await setPassword(tx, { userId, password: PASSWORD });
    });
  });

  afterAll(async () => {
    await db.close();
  });

  const attempt = (email: string, password: string, slug = SLUG) =>
    login(
      { query: (text, values) => db.appPool.query(text, values as unknown[] | undefined) },
      (tenantId, handler) => withTenant(db.appPool, tenantId, handler),
      { slug, email, password },
    );

  it('signs a person in and returns a session that resolves', async () => {
    const result = await attempt('analyst@auth.sa', PASSWORD);

    expect(result.userId).toBe(userId);
    expect(result.role).toBe('ANALYST');
    expect(result.session.token.startsWith('nxs_')).toBe(true);

    const resolved = await withoutTenant(db.appPool, (tx) =>
      resolveSession(tx, result.session.token),
    );
    expect(resolved?.tenantId).toBe(tenant.tenantId);
  });

  it('accepts the address in any case', async () => {
    const result = await attempt('ANALYST@AUTH.SA', PASSWORD);
    expect(result.userId).toBe(userId);
  });

  it('gives the same answer for a wrong password and an unknown address', async () => {
    const wrongPassword = await attempt('analyst@auth.sa', 'not the password at all').catch(
      (error: unknown) => error,
    );
    const unknownAddress = await attempt('nobody@auth.sa', PASSWORD).catch(
      (error: unknown) => error,
    );

    // A login form that answers differently is a directory of who works there.
    expect((wrongPassword as { code: string }).code).toBe('NX-4011');
    expect((unknownAddress as { code: string }).code).toBe('NX-4011');
    expect((wrongPassword as Error).message).toBe((unknownAddress as Error).message);
  });

  it('spends the same work on an unknown address as on a real one', async () => {
    const time = async (fn: () => Promise<unknown>): Promise<number> => {
      const started = process.hrtime.bigint();
      await fn().catch(() => undefined);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    const real = await time(() => attempt('analyst@auth.sa', 'wrong password entirely'));
    const unknown = await time(() => attempt('ghost@auth.sa', 'wrong password entirely'));

    // Returning early for an unknown address says out loud what the error refuses to say.
    // The bound is loose because this is a shared machine, but an early return would be
    // an order of magnitude apart, not a fraction.
    expect(unknown).toBeGreaterThan(real * 0.25);
  });

  it('refuses a person from another workspace', async () => {
    const other = await seedTenant(db.appPool, 'Auth Other Tenant');
    await withTenant(db.appPool, other.tenantId, async (tx) => {
      await tx.query(`UPDATE tenants SET slug = 'auth-other' WHERE id = $1`, [other.tenantId]);
      const id = await createUser(tx, {
        email: 'analyst@auth.sa',
        displayName: 'محلل آخر',
        role: 'ANALYST',
      });
      await setPassword(tx, { userId: id, password: PASSWORD });
    });

    // The same address exists in both workspaces, and the slug decides which one.
    const mine = await attempt('analyst@auth.sa', PASSWORD, SLUG);
    const theirs = await attempt('analyst@auth.sa', PASSWORD, 'auth-other');
    expect(mine.tenantId).toBe(tenant.tenantId);
    expect(theirs.tenantId).toBe(other.tenantId);
    expect(theirs.userId).not.toBe(mine.userId);
  });

  it('refuses an unknown workspace without saying so', async () => {
    const error = await attempt('analyst@auth.sa', PASSWORD, 'no-such-workspace').catch(
      (thrown: unknown) => thrown,
    );
    expect((error as { code: string }).code).toBe('NX-4011');
  });

  it('locks an account after repeated failures, and says that is why', async () => {
    const lockedId = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const id = await createUser(tx, {
        email: 'target@auth.sa',
        displayName: 'هدف',
        role: 'VIEWER',
      });
      await setPassword(tx, { userId: id, password: PASSWORD });
      return id;
    });

    for (let attemptNumber = 0; attemptNumber < 5; attemptNumber += 1) {
      await attempt('target@auth.sa', 'guessing').catch(() => undefined);
    }

    const error = await attempt('target@auth.sa', PASSWORD).catch((thrown: unknown) => thrown);
    // Even the right password is refused now, which is the point of a lock.
    expect((error as { code: string }).code).toBe('NX-4029');
    expect((error as { retryable: boolean }).retryable).toBe(true);
    expect(lockedId).toBeTruthy();
  });

  it('requires length and nothing else', () => {
    // Composition rules push people towards Password1! and towards writing it down.
    expect(() => assertPasswordAcceptable('a very long passphrase indeed')).not.toThrow();
    expect(() => assertPasswordAcceptable('short')).toThrow();
  });

  it('stores no password, only a slow hash with its own salt', async () => {
    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ hash_len: number; salt_len: number; params: { N: number } }>(
        `SELECT octet_length(password_hash) AS hash_len, octet_length(salt) AS salt_len, params
         FROM user_credentials WHERE user_id = $1`,
        [userId],
      ),
    );

    expect(rows[0]?.hash_len).toBe(64);
    expect(rows[0]?.salt_len).toBe(16);
    // The cost is stored beside the hash so it can be raised without invalidating it.
    expect(rows[0]?.params.N).toBeGreaterThanOrEqual(16_384);

    const { rows: leak } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ found: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM user_credentials
           WHERE encode(password_hash, 'escape') LIKE '%' || $1 || '%'
         ) AS found`,
        [PASSWORD],
      ),
    );
    expect(leak[0]?.found).toBe(false);
  });

  it('ends every session when the password changes', async () => {
    const session = await attempt('analyst@auth.sa', PASSWORD);

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      changeOwnPassword(tx, userId, PASSWORD, 'a different long passphrase'),
    );

    // Someone who has just been locked out of an account should not still be inside it.
    expect(
      await withoutTenant(db.appPool, (tx) => resolveSession(tx, session.session.token)),
    ).toBeNull();

    const after = await attempt('analyst@auth.sa', 'a different long passphrase');
    expect(after.userId).toBe(userId);
  });

  it('will not change a password without the current one', async () => {
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        changeOwnPassword(tx, userId, 'not the current one', 'another long passphrase here'),
      ),
      // A session left open on a shared machine should not be enough to take an account.
    ).rejects.toMatchObject({ code: 'NX-4011' });
  });

  it('records that a password was set, without recording the password', async () => {
    const entries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      readAudit(tx, { action: 'user.password_set' }),
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).not.toContain(PASSWORD);
  });
});
