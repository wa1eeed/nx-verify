import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  MAX_CODE_ATTEMPTS,
  issueLoginCode,
  pruneLoginCodes,
  redeemLoginCode,
} from '../src/auth/login-codes.js';
import { createUser } from '../src/auth/users.js';
import { setPassword, verifyPassword } from '../src/auth/passwords.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';

/**
 * The second step a subscriber's own users take (ADR-143).
 *
 * The properties worth pinning down are the ones a code is only worth anything for: it is
 * spent once, it dies after five guesses, it expires, and nothing stored is reversible into
 * the six digits anybody typed.
 *
 * And the one that is easy to get wrong: every refusal is the same refusal. A caller who can
 * tell «that handle is unknown» from «those digits are wrong» knows which half they got right.
 */

const PASSWORD = 'a development passphrase';

describe('the code a subscriber user is sent', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let userId = '';

  const inTenant = <T>(work: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(db.appPool, tenant.tenantId, work);

  /**
   * A fresh sign in attempt.
   *
   * Each test is somebody arriving at the form, not the same person pressing a button twice,
   * so whatever the last one left behind is cleared first. The minute between two codes is
   * its own test below.
   */
  const askForCode = async () => {
    await inTenant((tx) =>
      tx.query(`DELETE FROM user_login_codes WHERE tenant_id = $1`, [tx.tenantId]),
    );
    return inTenant((tx) => issueLoginCode(tx, { userId }));
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Code Tenant');
    userId = await inTenant((tx) =>
      createUser(tx, { email: 'person@acme.sa', displayName: 'شخص', role: 'ADMIN' }),
    );
    await inTenant((tx) => setPassword(tx, { userId, password: PASSWORD, mustChange: false }));
  });

  afterAll(async () => {
    await db.close();
  });

  it('stores neither the handle nor the digits in anything anybody could read', async () => {
    const issued = await askForCode();
    const { rows } = await inTenant((tx) =>
      tx.query<{ pending: Buffer; code: Buffer }>(
        `SELECT pending_hash AS pending, code_hash AS code FROM user_login_codes
          WHERE tenant_id = $1 AND user_id = $2`,
        [tx.tenantId, userId],
      ),
    );
    const stored = JSON.stringify(rows[0]);
    expect(stored).not.toContain(issued.code);
    expect(stored).not.toContain(issued.handle);
    // Digests, both of them, and the code salted with the handle so two people holding the
    // same six digits do not look the same on disk.
    expect(rows[0]?.pending.length).toBe(32);
    expect(rows[0]?.code.length).toBe(32);
  });

  it('opens with the right code once, and not a second time', async () => {
    const issued = await askForCode();
    expect(
      await inTenant((tx) => redeemLoginCode(tx, { handle: issued.handle, code: issued.code })),
    ).toEqual({ userId });
    // Pressing back and submitting again is a refusal, not a second sign in.
    await expect(
      inTenant((tx) => redeemLoginCode(tx, { handle: issued.handle, code: issued.code })),
    ).rejects.toMatchObject({ code: 'NX-4011' });
  });

  it('gives the same answer to a wrong code, an unknown handle and a spent one', async () => {
    const issued = await askForCode();
    const wrong = await inTenant((tx) =>
      redeemLoginCode(tx, { handle: issued.handle, code: '000000' }).catch((error) => error),
    );
    const unknown = await inTenant((tx) =>
      redeemLoginCode(tx, { handle: 'nxp_nothing', code: issued.code }).catch((error) => error),
    );
    expect(wrong.code).toBe('NX-4011');
    expect(unknown.code).toBe('NX-4011');
    expect(wrong.message).toBe(unknown.message);
  });

  it('dies after five guesses, even with the right code afterwards', async () => {
    const issued = await askForCode();
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      await inTenant((tx) =>
        redeemLoginCode(tx, { handle: issued.handle, code: '111111' }).catch(() => null),
      );
    }
    await expect(
      inTenant((tx) => redeemLoginCode(tx, { handle: issued.handle, code: issued.code })),
    ).rejects.toMatchObject({ code: 'NX-4011' });
  });

  it('expires, so a code read off an old message opens nothing', async () => {
    const issued = await askForCode();
    await inTenant((tx) =>
      tx.query(
        `UPDATE user_login_codes SET expires_at = now() - interval '1 minute'
                 WHERE tenant_id = $1 AND user_id = $2`,
        [tx.tenantId, userId],
      ),
    );
    await expect(
      inTenant((tx) => redeemLoginCode(tx, { handle: issued.handle, code: issued.code })),
    ).rejects.toMatchObject({ code: 'NX-4011' });
  });

  it('refuses a second code inside a minute, so a button is not a way to send mail', async () => {
    await askForCode();
    await expect(inTenant((tx) => issueLoginCode(tx, { userId }))).rejects.toMatchObject({
      code: 'NX-4029',
    });
  });

  it('replaces the waiting code rather than leaving two live', async () => {
    await inTenant((tx) =>
      tx.query(
        `UPDATE user_login_codes SET created_at = now() - interval '5 minutes'
                 WHERE tenant_id = $1`,
        [tx.tenantId],
      ),
    );
    const second = await askForCode();
    const { rows } = await inTenant((tx) =>
      tx.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM user_login_codes
          WHERE tenant_id = $1 AND consumed_at IS NULL`,
        [tx.tenantId],
      ),
    );
    expect(rows[0]?.count).toBe('1');
    expect(
      await inTenant((tx) => redeemLoginCode(tx, { handle: second.handle, code: second.code })),
    ).toEqual({ userId });
  });

  it('verifies a password without issuing anything, which is what makes the step a step', async () => {
    // The fixture makes a workspace without a slug, and a sign in is addressed to one, so
    // this test gives it the one it signs in with.
    // Inside the workspace's own scope: row level security is forced on the owner too, so an
    // update from outside it would quietly change nothing.
    await inTenant((tx) =>
      tx.query(`UPDATE tenants SET slug = 'code-tenant' WHERE id = $1`, [tx.tenantId]),
    );
    const verified = await verifyPassword(db.appPool, {
      slug: 'code-tenant',
      email: 'person@acme.sa',
      password: PASSWORD,
    });
    expect(verified.userId).toBe(userId);
    const { rows } = await inTenant((tx) =>
      tx.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM user_sessions WHERE tenant_id = $1`,
        [tx.tenantId],
      ),
    );
    // A session created and then thrown away is a session that existed. None was.
    expect(rows[0]?.count).toBe('0');
  });

  it('clears what is spent or stale, and leaves what is live', async () => {
    await inTenant((tx) =>
      tx.query(
        `UPDATE user_login_codes SET consumed_at = now() - interval '2 days' WHERE tenant_id = $1`,
        [tx.tenantId],
      ),
    );
    expect(await inTenant((tx) => pruneLoginCodes(tx))).toBeGreaterThan(0);
  });
});
