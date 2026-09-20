import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  MAX_SIGNUP_ATTEMPTS,
  completeSignup,
  pruneSignupIntents,
  slugFrom,
  startSignup,
} from '../src/signup/signup.js';
import { verifyPassword } from '../src/auth/passwords.js';
import { ownModules, setOwnModule } from '../src/modules/modules.js';
import { getWallet } from '../src/billing/wallet.js';
import { createTestDatabase, testKeys, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * A company signing itself up (ADR-154).
 *
 * The properties worth pinning down are the ones that make self service registration safe
 * rather than an abuse surface: no workspace exists until the address is proved, the answers
 * are unreadable while they wait, and the workspace that appears can spend nothing.
 */

const ANSWERS = {
  legalName: 'شركة الأفق للتجارة',
  activity: 'تجارة جملة أو تجزئة',
  unifiedNumber: '7001234567',
  contactName: 'وليد الغامدي',
  phone: '0512345678',
  password: 'a development passphrase',
};

describe('a company registering itself', () => {
  let db: TestDatabase;
  const keys = testKeys();

  const start = (email: string, over: Partial<typeof ANSWERS> = {}) =>
    startSignup(db.appPool, keys, { ...ANSWERS, ...over, email });

  const finish = (intentId: string, code: string) =>
    completeSignup(
      db.appPool,
      (tenantId, handler) => withTenant(db.appPool, tenantId, handler),
      keys,
      { intentId, code },
    );

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates no workspace until the address is proved', async () => {
    const before = await db.operatorPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM tenants`,
    );
    await start('waiting@ufuq.example.sa');
    const after = await db.operatorPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM tenants`,
    );
    // A form somebody abandons leaves a row that expires, not a tenant. A tenant is the thing
    // everything else in this platform hangs from.
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it('stores nothing readable while it waits', async () => {
    const started = await start('sealed@ufuq.example.sa');
    const { rows } = await db.appPool.query<{ payload: Buffer; code_hash: Buffer }>(
      `SELECT payload_enc AS payload, code_hash FROM signup_intents WHERE id = $1`,
      [started.intentId],
    );
    const stored = rows[0]?.payload.toString('utf8') ?? '';
    // Rule 4 has no exception for a registration form, and guard 05 walks every column.
    expect(stored).not.toContain(ANSWERS.unifiedNumber);
    expect(stored).not.toContain(ANSWERS.password);
    expect(JSON.stringify(rows[0])).not.toContain(started.code);
    expect(rows[0]?.code_hash.length).toBe(32);
  });

  it('makes the workspace and its administrator once the code is right', async () => {
    const started = await start('founder@ufuq.example.sa');
    const created = await finish(started.intentId, started.code);

    expect(created.answers.unifiedNumber).toBe(ANSWERS.unifiedNumber);
    expect(created.slug).toMatch(/^[a-z0-9][a-z0-9-]+$/);

    // They sign in with the password they chose, so nothing temporary is ever mailed.
    const verified = await verifyPassword(db.appPool, {
      slug: created.slug,
      email: 'founder@ufuq.example.sa',
      password: ANSWERS.password,
    });
    expect(verified.userId).toBe(created.userId);
  });

  it('opens with the right code once, and not a second time', async () => {
    const started = await start('once@ufuq.example.sa');
    await finish(started.intentId, started.code);
    await expect(finish(started.intentId, started.code)).rejects.toMatchObject({
      code: 'NX-4011',
    });
  });

  it('gives the same answer to a wrong code and an unknown intent', async () => {
    const started = await start('same@ufuq.example.sa');
    const wrong = await finish(started.intentId, '000000').catch((error) => error);
    const unknown = await finish('11111111-1111-1111-1111-111111111111', started.code).catch(
      (error) => error,
    );
    expect(wrong.code).toBe('NX-4011');
    expect(unknown.code).toBe('NX-4011');
    expect(wrong.message).toBe(unknown.message);
  });

  it('dies after five guesses, even with the right code afterwards', async () => {
    const started = await start('guess@ufuq.example.sa');
    for (let attempt = 0; attempt < MAX_SIGNUP_ATTEMPTS; attempt += 1) {
      await finish(started.intentId, '111111').catch(() => null);
    }
    await expect(finish(started.intentId, started.code)).rejects.toMatchObject({
      code: 'NX-4011',
    });
  });

  it('refuses a second code inside a minute, so a form is not a way to send mail', async () => {
    await start('flood@ufuq.example.sa');
    await expect(start('flood@ufuq.example.sa')).rejects.toMatchObject({ code: 'NX-4029' });
  });

  it('refuses answers that are not answers, and says which in Arabic', async () => {
    await expect(start('bad@ufuq.example.sa', { unifiedNumber: '123' })).rejects.toMatchObject({
      code: 'NX-4002',
    });
    await expect(start('bad@ufuq.example.sa', { phone: '0412345678' })).rejects.toMatchObject({
      code: 'NX-4002',
    });
    await expect(start('bad@ufuq.example.sa', { password: 'short' })).rejects.toMatchObject({
      code: 'NX-4002',
    });
  });

  it('gives the new workspace nothing to spend, which is what makes this safe', async () => {
    const started = await start('broke@ufuq.example.sa');
    const created = await finish(started.intentId, started.code);
    const wallet = await withTenant(db.appPool, created.tenantId, (tx) => getWallet(tx));
    // A hundred registrations are a hundred empty workspaces that have cost us nothing. The
    // registration gate keeps out robots; the wallet keeps out everybody who has not paid.
    expect(wallet.available).toBe(0);
  });

  it('lets them choose their own add-ons, and never switch the core one off', async () => {
    const started = await start('modules@ufuq.example.sa');
    const created = await finish(started.intentId, started.code);

    await withTenant(db.appPool, created.tenantId, async (tx) => {
      const before = await ownModules(tx);
      const core = before.find((module) => module.core);
      const addOn = before.find((module) => !module.core);
      expect(core?.enabled).toBe(true);

      await expect(
        setOwnModule(tx, {
          moduleCode: core?.code ?? '',
          enabled: false,
          userId: created.userId,
        }),
      ).rejects.toMatchObject({ code: 'NX-4003' });

      await setOwnModule(tx, {
        moduleCode: addOn?.code ?? '',
        enabled: true,
        userId: created.userId,
      });
      const after = await ownModules(tx);
      expect(after.find((module) => module.code === addOn?.code)?.enabled).toBe(true);
    });
  });

  it('makes a workspace name even from a name with no Latin letters in it', () => {
    // Which is the common case here, not the exception.
    expect(slugFrom('شركة الأفق')).toMatch(/^nx-[0-9a-f]{6}$/);
    expect(slugFrom('Ufuq Trading')).toMatch(/^ufuq-trading-[0-9a-f]{6}$/);
  });

  it('clears what was abandoned, by its own rule', async () => {
    await db.appPool.query(
      `UPDATE signup_intents SET expires_at = now() - interval '2 days'
        WHERE consumed_at IS NULL`,
    );
    // The sweep runs as the one role that may delete. The registrations this file completed
    // were spent moments ago, so they are counted separately and kept: see ADR-177 and
    // apps/worker/test/signup-retention.test.ts for the two clocks.
    const swept = await pruneSignupIntents(db.retentionPool);
    expect(swept.abandoned).toBeGreaterThan(0);
    expect(swept.consumed).toBe(0);
  });
});
