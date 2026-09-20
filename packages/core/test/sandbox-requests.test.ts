import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { OperatorIdentity } from '../src/operators/accounts.js';
import type { Queryable, TenantTransaction } from '../../db/src/client.js';
import { serialisedQuery, withTenant } from '../../db/src/client.js';
import { NxError } from '../src/errors.js';
import { createUser } from '../src/auth/users.js';
import { getWallet } from '../src/billing/wallet.js';
import {
  createSandboxForRequest,
  isSandbox,
  latestSandboxRequest,
  listPendingSandboxRequests,
  refuseSandboxRequest,
  requestSandbox,
  type SandboxProvisioner,
} from '../src/tenants/sandbox.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant } from '../../../test/helpers/billing.js';

/**
 * ADR-173: the subscriber asks for a sandbox, and the panel makes one.
 *
 * The part worth testing is not that two rows appear. It is that the ask can only be answered
 * by the operator connection, that answering it produces a workspace which is a sandbox by the
 * only definition this platform has, and that both trails carry what happened.
 */

const STAFF: OperatorIdentity = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'موظف الدعم',
  role: 'SUPPORT',
};

const READ_ONLY: OperatorIdentity = {
  id: '22222222-2222-4222-8222-222222222222',
  displayName: 'مطّلع',
  role: 'READ_ONLY',
};

/**
 * The two connections, wired as the console wires them.
 *
 * The operator transaction takes one client out of the pool and holds it, because a pool
 * satisfies `Queryable` while handing out a different connection per statement, which would
 * turn the BEGIN into a statement about nothing. There is no pooled operator reader beside it
 * any more: the read that chooses which ask is being answered belongs inside the transaction
 * that answers it, holding the row (ADR-180).
 */
function provisioner(db: TestDatabase): SandboxProvisioner {
  return {
    inOperatorTransaction: async <T>(run: (tx: Queryable) => Promise<T>): Promise<T> => {
      const client: pg.PoolClient = await db.operatorPool.connect();
      try {
        await client.query('BEGIN');
        const result = await run({ query: serialisedQuery(client) });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    inTenant: (tenantId, run) => withTenant(db.appPool, tenantId, run),
  };
}

describe('asking for a sandbox, and being given one', () => {
  let db: TestDatabase;
  let subscriber: SeededTenant;
  let requesterId: string;
  /** Kept from the one call that produced it, so the next test can look for it everywhere. */
  let temporaryPassword: string | null = null;
  let sandboxTenantId: string | null = null;

  beforeAll(async () => {
    db = await createTestDatabase();
    subscriber = await seedTenant(db.appPool, 'Asking Co');
    // The plans exist, so SANDBOX is a row rather than a constant (rule 8).
    await preparePricedTenant(db, subscriber.tenantId);

    requesterId = await withTenant(db.appPool, subscriber.tenantId, (tx) =>
      createUser(tx, {
        email: 'dev@asking.example',
        displayName: 'مهندسة التكامل',
        role: 'ADMIN',
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('records the ask in the subscriber own trail, and refuses a second one', async () => {
    const asked = await withTenant(db.appPool, subscriber.tenantId, (tx) =>
      requestSandbox(tx, { requestedBy: requesterId }),
    );
    expect(asked.status).toBe('REQUESTED');
    expect(asked.sandboxSlug).toBeNull();

    const trail = await withTenant(db.appPool, subscriber.tenantId, async (tx) => {
      const { rows } = await tx.query<{ action: string; actor_id: string }>(
        `SELECT action, actor_id FROM audit_log WHERE tenant_id = $1 AND action = 'sandbox.requested'`,
        [tx.tenantId],
      );
      return rows;
    });
    expect(trail).toHaveLength(1);
    expect(trail[0]?.actor_id).toBe(requesterId);

    // Pressing the button again is the same ask, not a second one in the queue.
    await expect(
      withTenant(db.appPool, subscriber.tenantId, (tx) =>
        requestSandbox(tx, { requestedBy: requesterId }),
      ),
    ).rejects.toThrow(NxError);
  });

  it('will not let a workspace answer its own ask', async () => {
    // The whole design rests on this: nx_app holds no UPDATE on the table, so a workspace
    // cannot write itself a sandbox any more than it can write tenants.sandbox_of.
    await expect(
      withTenant(db.appPool, subscriber.tenantId, (tx) =>
        tx.query(`UPDATE sandbox_requests SET status = 'CREATED' WHERE tenant_id = $1`, [
          tx.tenantId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('refuses a role that does not manage subscribers', async () => {
    const [pending] = await listPendingSandboxRequests(db.operatorPool);
    expect(pending?.tenantName).toBe('Asking Co');

    await expect(
      createSandboxForRequest(provisioner(db), READ_ONLY, { requestId: pending?.id ?? '' }),
    ).rejects.toThrow(NxError);
  });

  it('makes a workspace that is a sandbox by the only definition there is', async () => {
    const [pending] = await listPendingSandboxRequests(db.operatorPool);
    if (!pending) {
      throw new Error('the ask was not queued');
    }

    const created = await createSandboxForRequest(provisioner(db), STAFF, {
      requestId: pending.id,
    });
    temporaryPassword = created.account?.temporaryPassword ?? null;

    expect(created.slug.endsWith('-sandbox')).toBe(true);
    expect(created.legalName).toBe('Asking Co (Sandbox)');

    // The definition: sandbox_of points at the workspace that asked.
    expect(await withTenant(db.appPool, created.tenantId, (tx) => isSandbox(tx))).toBe(true);
    const { rows: linked } = await db.operatorPool.query<{
      sandbox_of: string;
      status: string;
      package_code: string;
    }>(
      `SELECT t.sandbox_of, t.status, c.package_code
       FROM tenants t JOIN tenant_commitments c ON c.tenant_id = t.id
       WHERE t.id = $1`,
      [created.tenantId],
    );
    expect(linked[0]?.sandbox_of).toBe(subscriber.tenantId);
    // Opened only after everything else, and open now.
    expect(linked[0]?.status).toBe('active');
    expect(linked[0]?.package_code).toBe('SANDBOX');

    // Play money, so the billing path runs there exactly as it does in production.
    const wallet = await withTenant(db.appPool, created.tenantId, (tx) => getWallet(tx));
    expect(wallet.balance).toBeGreaterThan(0);

    // The person who asked can sign in to it, and must change the password on arrival.
    expect(created.account?.email).toBe('dev@asking.example');
    const { rows: person } = await withTenant(db.appPool, created.tenantId, (tx) =>
      tx.query<{ email: string; role: string; must_change: boolean }>(
        `SELECT u.email, u.role, c.must_change
         FROM users u JOIN user_credentials c ON c.user_id = u.id AND c.tenant_id = u.tenant_id
         WHERE u.tenant_id = $1`,
        [tx.tenantId],
      ),
    );
    expect(person[0]?.email).toBe('dev@asking.example');
    expect(person[0]?.role).toBe('ADMIN');
    expect(person[0]?.must_change).toBe(true);
    sandboxTenantId = created.tenantId;
  });

  it('keeps the temporary password out of every trail and every row', async () => {
    if (temporaryPassword === null || sandboxTenantId === null) {
      throw new Error('no sandbox was made');
    }

    const rowsOf = (tenantId: string) =>
      withTenant(db.appPool, tenantId, async (tx) => {
        const { rows } = await tx.query<{ row: string }>(
          `SELECT row_to_json(a)::text AS row FROM audit_log a WHERE tenant_id = $1`,
          [tx.tenantId],
        );
        return rows.map((row) => row.row);
      });

    const { rows: staffTrail } = await db.operatorPool.query<{ row: string }>(
      `SELECT row_to_json(a)::text AS row FROM operator_audit a`,
    );
    const { rows: asks } = await db.operatorPool.query<{ row: string }>(
      `SELECT row_to_json(r)::text AS row FROM sandbox_requests r`,
    );

    // The password exists once, in the return value of the call that made it, and reaches the
    // screen that asked and nowhere else (SEC-10).
    const everything = [
      ...staffTrail.map((row) => row.row),
      ...asks.map((row) => row.row),
      ...(await rowsOf(subscriber.tenantId)),
      ...(await rowsOf(sandboxTenantId)),
    ].join('\n');
    expect(everything).not.toContain(temporaryPassword);
    // And the stored credential is a hash, not the word itself.
    const { rows: stored } = await withTenant(db.appPool, sandboxTenantId, (tx) =>
      tx.query<{ stored: string }>(
        `SELECT encode(password_hash, 'hex') AS stored FROM user_credentials WHERE tenant_id = $1`,
        [tx.tenantId],
      ),
    );
    expect(stored[0]?.stored).not.toContain(temporaryPassword);
  });

  it('tells both trails who made it, and tells the subscriber where to sign in', async () => {
    const { rows: staffTrail } = await db.operatorPool.query<{
      operator_id: string;
      action: string;
      target: string;
    }>(
      `SELECT operator_id, action, target FROM operator_audit
       WHERE action = 'subscribers.sandbox_created'`,
    );
    expect(staffTrail).toHaveLength(1);
    expect(staffTrail[0]?.operator_id).toBe(STAFF.id);
    expect(staffTrail[0]?.target).toBe(`subscriber:${subscriber.tenantId}`);

    const answered = await withTenant(db.appPool, subscriber.tenantId, (tx) =>
      latestSandboxRequest(tx),
    );
    expect(answered?.status).toBe('CREATED');
    // The name to sign in with, copied onto the row because the subscriber's own connection
    // can read exactly one row of tenants: its own.
    expect(answered?.sandboxSlug).toMatch(/-sandbox$/);

    const { rows: ownTrail } = await withTenant(db.appPool, subscriber.tenantId, (tx) =>
      tx.query<{ actor_type: string; actor_id: string }>(
        `SELECT actor_type, actor_id FROM audit_log
         WHERE tenant_id = $1 AND action = 'sandbox.created'`,
        [tx.tenantId],
      ),
    );
    expect(ownTrail).toHaveLength(1);
    expect(ownTrail[0]?.actor_type).toBe('NX_STAFF');
    expect(ownTrail[0]?.actor_id).toBe(STAFF.id);
  });

  it('refuses a second sandbox for the same workspace', async () => {
    // The ask is allowed again once the first was answered, and the answer is no.
    const second = await withTenant(db.appPool, subscriber.tenantId, (tx) =>
      requestSandbox(tx, { requestedBy: requesterId }),
    );

    const pending = await listPendingSandboxRequests(db.operatorPool);
    const open = pending.find((row) => row.id === second.id);
    expect(open?.alreadyHasSandbox).toBe(true);

    await expect(
      createSandboxForRequest(provisioner(db), STAFF, { requestId: second.id }),
    ).rejects.toThrow(NxError);

    // And nothing was half made: the workspace still has exactly one sandbox.
    const { rows } = await db.operatorPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM tenants WHERE sandbox_of = $1`,
      [subscriber.tenantId],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('records a refusal with a reason the screen can say in Arabic', async () => {
    const [open] = await listPendingSandboxRequests(db.operatorPool);
    if (!open) {
      throw new Error('the second ask was not queued');
    }

    await refuseSandboxRequest(db.operatorPool, STAFF, {
      requestId: open.id,
      code: 'HAS_SANDBOX',
    });

    const { rows: refused } = await db.operatorPool.query<{
      status: string;
      refusal_code: string;
      decided_by: string;
    }>(`SELECT status, refusal_code, decided_by FROM sandbox_requests WHERE id = $1`, [open.id]);
    expect(refused[0]?.status).toBe('REFUSED');
    expect(refused[0]?.refusal_code).toBe('HAS_SANDBOX');
    expect(refused[0]?.decided_by).toBe(STAFF.id);

    const { rows: told } = await withTenant(db.appPool, subscriber.tenantId, (tx) =>
      tx.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE tenant_id = $1 AND action = 'sandbox.refused'`,
        [tx.tenantId],
      ),
    );
    expect(told).toHaveLength(1);

    // The queue is empty again, and the live answer is still the sandbox that exists.
    expect(await listPendingSandboxRequests(db.operatorPool)).toHaveLength(0);
    const live = await withTenant(db.appPool, subscriber.tenantId, (tx) =>
      latestSandboxRequest(tx),
    );
    expect(live?.status).toBe('CREATED');
  });

  it('refuses an ask made from inside a sandbox', async () => {
    const { rows } = await db.operatorPool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE sandbox_of = $1`,
      [subscriber.tenantId],
    );
    const sandboxId = rows[0]?.id;
    if (!sandboxId) {
      throw new Error('no sandbox to ask from');
    }

    await expect(withTenant(db.appPool, sandboxId, (tx) => requestSandbox(tx))).rejects.toThrow(
      NxError,
    );
  });

  it('cannot see another workspace ask', async () => {
    const other = await seedTenant(db.appPool, 'Somebody Else Co');
    const seen = await withTenant(db.appPool, other.tenantId, (tx) => latestSandboxRequest(tx));
    expect(seen).toBeNull();
  });

  /**
   * ADR-180: two members of staff, one ask, and the workspace that used to be left behind.
   *
   * The order of the steps was said to protect this and did not. The ask was read on a pooled
   * connection, the workspace and its person and its wallet were committed on the subscriber's
   * connection, and only then did the operator transaction try to write the answer. A refusal
   * landing in that gap turned the answer into zero rows and rolled the operator transaction
   * back with the workspace already committed: linked to nobody, on no screen, holding the slug
   * every later attempt for that subscriber needs.
   *
   * The refusal here is fired at the exact moment the old code was defenceless, which is after
   * the workspace has committed. With the ask locked for the length of the answer it waits
   * there instead of passing, and finds the ask closed when it is let through.
   */
  it('makes a refusal wait for an answer in progress, and leaves no workspace behind', async () => {
    const racing = await seedTenant(db.appPool, 'Racing Co');
    const asker = await withTenant(db.appPool, racing.tenantId, (tx) =>
      createUser(tx, {
        email: 'dev@racing.example',
        displayName: 'مهندس التكامل',
        role: 'ADMIN',
      }),
    );
    const asked = await withTenant(db.appPool, racing.tenantId, (tx) =>
      requestSandbox(tx, { requestedBy: asker }),
    );

    const base = provisioner(db);
    /** The second answer, once it has been started. Empty until the moment it is fired. */
    const refusals: Promise<unknown>[] = [];
    const answeredTwiceAtOnce: SandboxProvisioner = {
      inOperatorTransaction: base.inOperatorTransaction,
      inTenant: async <T>(
        tenantId: string,
        run: (tx: TenantTransaction) => Promise<T>,
      ): Promise<T> => {
        const result = await base.inTenant(tenantId, run);
        if (refusals.length === 0 && tenantId !== racing.tenantId) {
          // The new workspace has just committed. The second member of staff presses «أكّد
          // أنها لا تُنشأ» on the same row now.
          refusals.push(
            refuseSandboxRequest(db.operatorPool, STAFF, {
              requestId: asked.id,
              code: 'NOT_ELIGIBLE',
            }).then(
              () => 'refused',
              (error: unknown) => error,
            ),
          );
          // Long enough to reach the row and wait on it, rather than to be still on its way
          // when the answer commits, which would prove nothing either way.
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return result;
      },
    };

    let made: Awaited<ReturnType<typeof createSandboxForRequest>> | null = null;
    let failed: unknown = null;
    try {
      made = await createSandboxForRequest(answeredTwiceAtOnce, STAFF, { requestId: asked.id });
    } catch (error) {
      failed = error;
    }

    // The press that was already making a workspace finishes it.
    expect(failed).toBeNull();
    expect(made?.slug.endsWith('-sandbox')).toBe(true);

    // The one that arrived in the middle is told the ask is no longer open, which is what it
    // is: it never reached the row while the row was still open.
    expect(refusals).toHaveLength(1);
    const outcome: unknown = await refusals[0];
    expect(outcome).toBeInstanceOf(NxError);
    expect((outcome as NxError).code).toBe('NX-4041');

    // Nothing was left over. A workspace whose name ends in -sandbox and which is the sandbox
    // of nobody is the exact row the old order committed and could not take back.
    const { rows: orphans } = await db.operatorPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM tenants
       WHERE slug LIKE '%-sandbox' AND sandbox_of IS NULL`,
    );
    expect(orphans[0]?.count).toBe('0');

    // And the ask reads as answered once, by the answer that actually happened.
    const { rows: answered } = await db.operatorPool.query<{
      status: string;
      refusal_code: string | null;
      sandbox_tenant_id: string | null;
    }>(`SELECT status, refusal_code, sandbox_tenant_id FROM sandbox_requests WHERE id = $1`, [
      asked.id,
    ]);
    expect(answered[0]?.status).toBe('CREATED');
    expect(answered[0]?.refusal_code).toBeNull();
    expect(answered[0]?.sandbox_tenant_id).toBe(made?.tenantId);

    // The workspace is open, and the refusal that lost wrote nothing in either trail.
    const { rows: workspace } = await db.operatorPool.query<{ status: string; refusals: string }>(
      `SELECT t.status,
              (SELECT count(*)::text FROM operator_audit a
                WHERE a.action = 'subscribers.sandbox_refused'
                  AND a.target = $2) AS refusals
       FROM tenants t WHERE t.id = $1`,
      [made?.tenantId ?? '', `subscriber:${racing.tenantId}`],
    );
    expect(workspace[0]?.status).toBe('active');
    expect(workspace[0]?.refusals).toBe('0');
  });
});
