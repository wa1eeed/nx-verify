import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { createTestDatabase, seedTenant, type TestDatabase } from '../../../test/helpers/db.js';
import {
  ABANDONED_INTENT_GRACE_DAYS,
  CONSUMED_INTENT_KEPT_HOURS,
  pruneSignupIntents,
} from '../../../packages/core/src/signup/signup.js';

/**
 * ADR-177: a registration nobody finished does not keep its answers for ever.
 *
 * `signup_intents` holds a legal name, a unified number, a contact name, a phone and the
 * passphrase the person chose, all sealed in one payload, in the one table with no tenant and
 * therefore no row level security over it. The sweep that was supposed to clear it existed and
 * was never called.
 *
 * Two rules, not one, and the tests below pin the difference: a row that became a workspace is
 * mostly a duplicate of that workspace and goes within the hour, and a row whose code nobody
 * read is personal data with nothing on the other side of it and goes a day after the code
 * dies. «Mostly», because the unified number and the phone are read out of the payload by
 * `completeSignup` and written nowhere: see the constant's own comment.
 */

interface IntentSeed {
  email: string;
  /** SQL for `expires_at`, relative to now. */
  expiresAt: string;
  /** SQL for `consumed_at`, or null for a registration nobody finished. */
  consumedAt: string | null;
}

describe('half finished registrations do not live for ever', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  /** Written as the application role, which is the role that writes them in life. */
  const seed = async (rows: IntentSeed[]): Promise<void> => {
    await withoutTenant(db.appPool, async (tx) => {
      await tx.query(`DELETE FROM signup_intents`);
      for (const row of rows) {
        await tx.query(
          `INSERT INTO signup_intents (email, payload_enc, key_version, code_hash, expires_at,
                                       consumed_at)
           VALUES ($1, '\\x00'::bytea, 1, decode(repeat('00', 32), 'hex'),
                   now() + ($2)::interval, ${row.consumedAt === null ? 'NULL' : `now() + ($3)::interval`})`,
          row.consumedAt === null
            ? [row.email, row.expiresAt]
            : [row.email, row.expiresAt, row.consumedAt],
        );
      }
    });
  };

  /** The sweep runs on the retention connection, the way the worker registers it. */
  const sweep = () => withoutTenant(db.retentionPool, (tx) => pruneSignupIntents(tx));

  const remaining = async (): Promise<string[]> => {
    const { rows } = await withoutTenant(db.appPool, (tx) =>
      tx.query<{ email: string }>(`SELECT email FROM signup_intents ORDER BY email`),
    );
    return rows.map((row) => row.email);
  };

  it('clears a registration whose code died a day ago, and keeps one that died an hour ago', async () => {
    expect(ABANDONED_INTENT_GRACE_DAYS).toBe(1);
    await seed([
      { email: 'gone@ufuq.example.sa', expiresAt: '-2 days', consumedAt: null },
      { email: 'recent@ufuq.example.sa', expiresAt: '-1 hour', consumedAt: null },
      { email: 'open@ufuq.example.sa', expiresAt: '20 minutes', consumedAt: null },
    ]);

    const swept = await sweep();
    expect(swept).toEqual({ consumed: 0, abandoned: 1 });
    // An expired code is not the same thing as a code still being read, and neither is the
    // same thing as a registration somebody may still be asking support about today.
    expect(await remaining()).toEqual(['open@ufuq.example.sa', 'recent@ufuq.example.sa']);
  });

  it('clears a spent registration an hour after it made a workspace, and keeps one just spent', async () => {
    expect(CONSUMED_INTENT_KEPT_HOURS).toBe(1);
    await seed([
      // The realistic shape: a code is read inside its thirty minutes, so the expiry of a
      // consumed row is always within half an hour of the moment it was consumed.
      { email: 'old-spent@ufuq.example.sa', expiresAt: '-3 hours', consumedAt: '-3 hours' },
      { email: 'just-spent@ufuq.example.sa', expiresAt: '20 minutes', consumedAt: '-10 minutes' },
    ]);

    const swept = await sweep();
    expect(swept).toEqual({ consumed: 1, abandoned: 0 });
    // The one just spent stays for the person who presses back and submits again.
    expect(await remaining()).toEqual(['just-spent@ufuq.example.sa']);
  });

  it('never lets the expiry rule reach a row that was consumed', async () => {
    /*
     * A shape the form cannot produce, written on purpose: it is the rule being pinned, not a
     * row. Before ADR-177 the sweep was a single statement whose expiry clause carried no
     * `consumed_at IS NULL`, so it reached spent rows too and the clause written for them
     * could never fire on anything. This row is the clean separation of the two clocks.
     */
    await seed([
      { email: 'crossed@ufuq.example.sa', expiresAt: '-5 days', consumedAt: '-1 minute' },
    ]);

    const swept = await sweep();
    expect(swept).toEqual({ consumed: 0, abandoned: 0 });
    expect(await remaining()).toEqual(['crossed@ufuq.example.sa']);
  });

  it('is deleted by the retention role, which migration 0058 granted for it', async () => {
    const { rows } = await withoutTenant(db.appPool, (tx) =>
      tx.query<{ may: boolean }>(
        `SELECT has_table_privilege('nx_retention', 'signup_intents', 'DELETE') AS may`,
      ),
    );
    expect(rows[0]?.may).toBe(true);

    await seed([{ email: 'swept@ufuq.example.sa', expiresAt: '-9 days', consumedAt: null }]);
    // Not «the job removed it» but «the retention connection removed it», which is the claim
    // the worker's wiring makes: every deletion in this platform runs as the role that may.
    expect(await sweep()).toEqual({ consumed: 0, abandoned: 1 });
    expect(await remaining()).toEqual([]);
  });

  it('deletes on the path the worker actually takes, inside a tenant scoped transaction', async () => {
    /*
     * The sweep above runs with no tenant in scope, and the worker does not. A job declared
     * `scope: 'global'` is still handed `withTenant(retentionPool, tenantIds[0], …)`, because
     * that is the only kind of connection the scheduler has. So the production path is a
     * tenant scoped transaction on the retention role reaching a table that has no tenant at
     * all, and that is the path pinned here rather than inferred.
     *
     * It also records the coupling: a global job is skipped entirely when no workspace is
     * active, so this sweep needs one to exist even though the rows it clears predate any.
     */
    const tenant = await seedTenant(db.appPool, 'Sweeping Tenant');
    await seed([
      { email: 'as-the-worker@ufuq.example.sa', expiresAt: '-3 days', consumedAt: null },
    ]);

    const swept = await withTenant(db.retentionPool, tenant.tenantId, (tx) =>
      pruneSignupIntents(tx),
    );
    expect(swept).toEqual({ consumed: 0, abandoned: 1 });
    expect(await remaining()).toEqual([]);
  });
});
