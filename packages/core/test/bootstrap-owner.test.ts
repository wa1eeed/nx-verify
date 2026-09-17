import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapOwnerFromEnv, ensureBootstrapOwner } from '../src/operators/bootstrap.js';
import { authenticateOperator } from '../src/operators/accounts.js';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * The first owner of the panel, from the deployment's own variables (ADR-142).
 *
 * A platform put on a server through a deployment tool has no console to run a command in and
 * nobody to paste a token, so the owner comes from the same place every other setting does.
 *
 * The rule this file pins down is the one that will surprise somebody otherwise: the
 * environment wins. A password changed inside the panel is overwritten at the next start, and
 * every session opened under the old one stops working. That is what makes a variable useful,
 * and it is better written down in a test than discovered on a Tuesday.
 */

const PASSWORD = 'a development passphrase';
const CHANGED = 'another development passphrase';

describe('the owner a deployment configures', () => {
  let db: TestDatabase;
  const owner = () => db.operatorPool;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('makes the owner on the first start, and signs in with it', async () => {
    expect(
      await ensureBootstrapOwner(owner(), { email: 'Boss@NX.local', password: PASSWORD }),
    ).toEqual({ outcome: 'created' });

    // The address is stored as it is compared: lowercased, so a capital letter in a
    // deployment variable does not make a second owner on the next start.
    const signedIn = await authenticateOperator(owner(), 'boss@nx.local', PASSWORD);
    expect(signedIn.role).toBe('OWNER');
  });

  it('does nothing at all when the variables have not changed', async () => {
    expect(
      await ensureBootstrapOwner(owner(), { email: 'boss@nx.local', password: PASSWORD }),
    ).toEqual({ outcome: 'unchanged' });
  });

  it('lets the deployment change the password, and ends the sessions opened under the old one', async () => {
    const before = await credentialVersion();
    expect(
      await ensureBootstrapOwner(owner(), { email: 'boss@nx.local', password: CHANGED }),
    ).toEqual({ outcome: 'password_updated' });

    await expect(authenticateOperator(owner(), 'boss@nx.local', PASSWORD)).rejects.toMatchObject({
      code: 'NX-4011',
    });
    expect((await authenticateOperator(owner(), 'boss@nx.local', CHANGED)).role).toBe('OWNER');
    // A session carries the version it was opened under, so raising it is what stops one.
    expect(await credentialVersion()).toBe(before + 1);
  });

  it('never touches the authenticator, so a redeployment is not a quiet downgrade', async () => {
    await owner().query(
      `UPDATE operator_accounts
          SET totp_secret_enc = $1, totp_key_version = 1, totp_confirmed_at = now()
        WHERE lower(email) = 'boss@nx.local'`,
      [Buffer.from('not a real secret')],
    );
    await ensureBootstrapOwner(owner(), { email: 'boss@nx.local', password: 'a third passphrase' });
    const { rows } = await owner().query<{ confirmed: Date | null }>(
      `SELECT totp_confirmed_at AS confirmed FROM operator_accounts WHERE lower(email) = 'boss@nx.local'`,
    );
    expect(rows[0]?.confirmed).not.toBeNull();
  });

  it('refuses a mistyped address and a short password without stopping the worker', async () => {
    expect(
      (await ensureBootstrapOwner(owner(), { email: 'not-an-address', password: PASSWORD }))
        .outcome,
    ).toBe('skipped');
    expect(
      (await ensureBootstrapOwner(owner(), { email: 'second@nx.local', password: 'short' }))
        .outcome,
    ).toBe('skipped');
    // And neither left an account behind.
    const { rows } = await owner().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM operator_accounts WHERE lower(email) = 'second@nx.local'`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('does nothing when the deployment configures no owner, which is not an error', async () => {
    expect((await bootstrapOwnerFromEnv(owner(), {})).outcome).toBe('skipped');
  });

  it('reads the panel owner, and never the database role that has a similar name', async () => {
    // `NX_OPERATOR_PASSWORD` is the password of the `nx_operator` DATABASE ROLE, set by the
    // migrate runner. If this ever read it, a deployment's database credential would become
    // the password somebody types into a sign in form, and the sign in password would be a
    // connection credential. They are not the same secret and must never share a name.
    expect(
      (
        await bootstrapOwnerFromEnv(owner(), {
          NX_OPERATOR_EMAIL: 'role@nx.local',
          NX_OPERATOR_PASSWORD: 'the database role password',
        })
      ).outcome,
    ).toBe('skipped');
    const { rows } = await owner().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM operator_accounts WHERE lower(email) = 'role@nx.local'`,
    );
    expect(rows[0]?.count).toBe('0');

    expect(
      (
        await bootstrapOwnerFromEnv(owner(), {
          NX_PANEL_OWNER_EMAIL: 'panel@nx.local',
          NX_PANEL_OWNER_PASSWORD: PASSWORD,
          NX_PANEL_OWNER_NAME: 'مالك اللوحة',
        })
      ).outcome,
    ).toBe('created');
    expect((await authenticateOperator(owner(), 'panel@nx.local', PASSWORD)).role).toBe('OWNER');
  });

  const credentialVersion = async (): Promise<number> => {
    const { rows } = await owner().query<{ version: number }>(
      `SELECT credential_version AS version FROM operator_accounts WHERE lower(email) = 'boss@nx.local'`,
    );
    return rows[0]?.version ?? 0;
  };
});
