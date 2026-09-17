import type { Queryable } from '@nx-verify/db';
import { PASSWORD_REQUIREMENTS, passwordMatches, sealPassword } from '../auth/passwords.js';
import { recordOperatorAudit } from './audit.js';

/**
 * The first owner of the panel, from the deployment's own configuration (ADR-142).
 *
 * A platform deployed to a server through Coolify has no console to run a command in and no
 * token to paste: the first person in has to come from the same place every other setting
 * does. So two environment variables name the owner, and this makes them true on every start.
 *
 * **The environment wins.** Change the password in the deployment's variables, redeploy, and
 * that is the password: which is exactly what an operator wants from a variable, and the
 * trade-off is stated rather than discovered. A password changed inside the panel is
 * overwritten at the next restart, so it is changed in the deployment or not at all. Every
 * session opened under the old one stops working, because `credential_version` moves with it.
 *
 * What it never does is touch the second factor. An authenticator survives a redeployment: a
 * bootstrap that cleared it would quietly turn two steps into one on every deploy, which is
 * the sort of downgrade nobody notices until it matters.
 */

export interface BootstrapOwnerInput {
  email: string;
  password: string;
  displayName?: string | undefined;
}

export type BootstrapOutcome = 'created' | 'password_updated' | 'unchanged' | 'skipped';

export interface BootstrapResult {
  outcome: BootstrapOutcome;
  /** Why nothing was done, when nothing was. Never carries the password. */
  reason?: string;
}

/**
 * Reads the two variables and makes them true, or says why it did not.
 *
 * Returns rather than throws: a worker that cannot start because an address was mistyped is a
 * platform that stops verifying, and the panel can still be reached by whoever is already in.
 */
export async function ensureBootstrapOwner(
  db: Queryable,
  input: BootstrapOwnerInput,
): Promise<BootstrapResult> {
  const email = input.email.trim().toLowerCase();
  if (email === '' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { outcome: 'skipped', reason: 'the configured owner address is not an address' };
  }
  if (input.password.length < PASSWORD_REQUIREMENTS.minLength) {
    return {
      outcome: 'skipped',
      reason: `the configured owner password is shorter than ${PASSWORD_REQUIREMENTS.minLength} characters`,
    };
  }

  const { rows } = await db.query<{
    id: string;
    password_hash: Buffer;
    password_salt: Buffer;
    password_params: Record<string, number>;
    status: string;
  }>(
    `SELECT id, password_hash, password_salt, password_params, status
       FROM operator_accounts WHERE lower(email) = $1`,
    [email],
  );
  const existing = rows[0];
  const sealed = await sealPassword(input.password);

  if (!existing) {
    await db.query(
      // `created_by` names another account, and a deployment variable is not one: it stays
      // null exactly as it does for the first owner made from the panel's token.
      `INSERT INTO operator_accounts
         (email, display_name, role, password_hash, password_salt, password_params)
       VALUES ($1, $2, 'OWNER', $3, $4, $5::jsonb)`,
      [
        email,
        input.displayName?.trim() || 'مالك المنصة',
        sealed.hash,
        sealed.salt,
        JSON.stringify(sealed.params),
      ],
    );
    await recordOperatorAudit(db, {
      operatorId: 'nx-staff:bootstrap',
      action: 'staff.first_owner',
      target: `staff:${email}`,
      // The address and the role. Never the password (rule 10 in spirit: a credential is not
      // a thing we write down anywhere it can be read back).
      metadata: { role: 'OWNER', from: 'environment' },
    });
    return { outcome: 'created' };
  }

  const same = await passwordMatches(input.password, {
    hash: existing.password_hash,
    salt: existing.password_salt,
    params: existing.password_params as never,
  });
  if (same && existing.status === 'ACTIVE') {
    return { outcome: 'unchanged' };
  }

  await db.query(
    `UPDATE operator_accounts
        SET password_hash = $2, password_salt = $3, password_params = $4::jsonb,
            status = 'ACTIVE', failed_attempts = 0, locked_until = NULL,
            credential_version = credential_version + 1, updated_at = now()
      WHERE id = $1`,
    [existing.id, sealed.hash, sealed.salt, JSON.stringify(sealed.params)],
  );
  await recordOperatorAudit(db, {
    operatorId: 'nx-staff:bootstrap',
    action: 'staff.password_set',
    target: `staff:${existing.id}`,
    metadata: { from: 'environment' },
  });
  return { outcome: 'password_updated' };
}

/**
 * The same, from a process environment. Absent variables mean «nobody configured this», which
 * is not a failure: a deployment that makes its first owner from the panel's token still works.
 *
 * Named for the panel rather than for the operator, deliberately. `NX_OPERATOR_PASSWORD` was
 * already taken, by the password of the `nx_operator` **database role**, and the two are not the
 * same secret in any sense: one is a connection string's credential, the other is typed into a
 * sign in form by a person. Sharing the name would have made the panel's password a database
 * credential and the database credential something a person types into a browser.
 */
export async function bootstrapOwnerFromEnv(
  db: Queryable,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<BootstrapResult> {
  const email = env['NX_PANEL_OWNER_EMAIL'];
  const password = env['NX_PANEL_OWNER_PASSWORD'];
  if (!email || !password) {
    return {
      outcome: 'skipped',
      reason: 'NX_PANEL_OWNER_EMAIL and NX_PANEL_OWNER_PASSWORD are not set',
    };
  }
  return ensureBootstrapOwner(db, {
    email,
    password,
    ...(env['NX_PANEL_OWNER_NAME'] === undefined
      ? {}
      : { displayName: env['NX_PANEL_OWNER_NAME'] }),
  });
}
