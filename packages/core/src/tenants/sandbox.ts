import { randomBytes, randomUUID } from 'node:crypto';
import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { audit } from '../auth/audit.js';
import { createUser } from '../auth/users.js';
import { setPassword } from '../auth/passwords.js';
import { topUp } from '../billing/wallet.js';
import { recordOperatorAudit } from '../operators/audit.js';
import { operatorCan, type OperatorIdentity } from '../operators/accounts.js';

/**
 * The sandbox workspace: knowing you are in one, and getting one.
 *
 * A customer's test traffic runs in a workspace of its own rather than behind a flag on
 * the real one, so isolation is row level security rather than a column every query has
 * to remember. See ADR-068.
 *
 * What a caller needs from the first half of this module is one boolean: is the workspace I
 * am in a sandbox. A screen uses it to say so, a sealed document uses it to stamp itself, and
 * neither has to know how the link is stored.
 *
 * The second half is the part that was missing, and it was missing for a reason worth
 * keeping. 0027 grants `UPDATE (sandbox_of) ON tenants` to the operator role alone, because a
 * workspace that can declare itself a sandbox can do it retrospectively and reclassify a year
 * of real verifications as tests. That grant is right, and its consequence is that making a
 * sandbox is not something a subscriber's own session can do, however many buttons it has. So
 * the subscriber asks, in `sandbox_requests`, and a member of staff answers. See ADR-173.
 *
 * There was a third function here, `findSandboxOf`, which answered «which workspace is this
 * subscriber's sandbox» on a connection that crosses workspaces. It was deleted as unused, and
 * its comment said the feature it was waiting for, making a sandbox from the panel, «needs more
 * than a lookup». That is what the rest of this file is.
 */

export interface SandboxLink {
  tenantId: string;
  /** The real workspace this one is the sandbox of. Null when this workspace is real. */
  sandboxOf: string | null;
  isSandbox: boolean;
}

export async function sandboxLink(tx: TenantTransaction): Promise<SandboxLink> {
  const { rows } = await tx.query<{ id: string; sandbox_of: string | null }>(
    `SELECT id, sandbox_of FROM tenants WHERE id = $1`,
    [tx.tenantId],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', { detail: 'no such workspace' });
  }
  return { tenantId: row.id, sandboxOf: row.sandbox_of, isSandbox: row.sandbox_of !== null };
}

export async function isSandbox(tx: TenantTransaction): Promise<boolean> {
  return (await sandboxLink(tx)).isSandbox;
}

/* ------------------------------------------------------------------ asking */

export type SandboxRequestStatus = 'REQUESTED' | 'CREATED' | 'REFUSED';

/** Why no sandbox was made. A fixed list, because rule 6 allows no typed reason here. */
export type SandboxRefusalCode = 'HAS_SANDBOX' | 'NOT_ELIGIBLE';

export interface SandboxRequest {
  id: string;
  status: SandboxRequestStatus;
  requestedAt: Date;
  decidedAt: Date | null;
  /** The workspace name to sign in to, once one exists. */
  sandboxSlug: string | null;
  refusalCode: SandboxRefusalCode | null;
}

interface SandboxRequestRow {
  id: string;
  status: SandboxRequestStatus;
  requested_at: Date;
  decided_at: Date | null;
  sandbox_slug: string | null;
  refusal_code: SandboxRefusalCode | null;
}

const REQUEST_COLUMNS = `id, status, requested_at, decided_at, sandbox_slug, refusal_code`;

function toRequest(row: SandboxRequestRow): SandboxRequest {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    sandboxSlug: row.sandbox_slug,
    refusalCode: row.refusal_code,
  };
}

/**
 * The subscriber asks for a sandbox.
 *
 * It refuses from inside a sandbox, which is not pedantry: `tenants` forbids a sandbox owning
 * another one, so a request made there could never be answered, and a queue full of requests
 * that cannot be granted is how staff stop reading the queue.
 */
export async function requestSandbox(
  tx: TenantTransaction,
  input: { requestedBy?: string | null } = {},
): Promise<SandboxRequest> {
  if (await isSandbox(tx)) {
    throw new NxError('NX-4091', {
      detail: 'this workspace is a sandbox, and a sandbox has no sandbox of its own',
    });
  }

  const { rows } = await tx
    .query<SandboxRequestRow>(
      `INSERT INTO sandbox_requests (tenant_id, requested_by)
       VALUES ($1, $2)
       RETURNING ${REQUEST_COLUMNS}`,
      [tx.tenantId, input.requestedBy ?? null],
    )
    .catch((error: unknown) => {
      // Both partial unique indexes land here: one open ask per workspace, and one made
      // sandbox per workspace. Either way the answer is that there is nothing to ask for.
      if (isUniqueViolation(error)) {
        throw new NxError('NX-4091', { detail: 'this workspace already asked for a sandbox' });
      }
      throw error;
    });

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-5001', { detail: 'the request could not be recorded' });
  }

  await audit(tx, {
    actorType: 'USER',
    actorId: input.requestedBy ?? 'system',
    action: 'sandbox.requested',
    target: row.id,
  });

  return toRequest(row);
}

/**
 * What this workspace was told about its sandbox, if anything.
 *
 * The newest row, because a refused ask can be followed by another one and the screen should
 * show the live answer rather than the first one.
 */
export async function latestSandboxRequest(tx: TenantTransaction): Promise<SandboxRequest | null> {
  const { rows } = await tx.query<SandboxRequestRow>(
    `SELECT ${REQUEST_COLUMNS} FROM sandbox_requests
     WHERE tenant_id = $1
     ORDER BY (status = 'CREATED') DESC, requested_at DESC
     LIMIT 1`,
    [tx.tenantId],
  );
  const row = rows[0];
  return row ? toRequest(row) : null;
}

/* ---------------------------------------------------------------- answering */

export interface PendingSandboxRequest extends SandboxRequest {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  /** True when this workspace already has a sandbox, so the ask cannot be granted. */
  alreadyHasSandbox: boolean;
}

/**
 * How many asks are open, and nothing else about them (ADR-186).
 *
 * The second sentence of rule 2: a number on a screen comes from a counter, not from a list
 * somebody measured. The panel's frame draws this beside the place the queue lives under, on
 * every render of every panel screen, and it used to get it by calling
 * `listPendingSandboxRequests` and taking `.length`: every open ask, each carrying a
 * subscriber's legal name and workspace name, read across every subscriber on the platform, so
 * that one digit could be drawn. What the screen needed was the digit.
 *
 * So this is `count(*)` over one predicate, with no join at all. 0068 indexes
 * `sandbox_requests (requested_at) WHERE status = 'REQUESTED'` for exactly this shape, so the
 * number costs the same whether two subscribers are waiting or two thousand, and no name
 * crosses a boundary to produce a badge. It is named for what it returns, so the next person
 * reading the frame can see that it counts rather than reads.
 *
 * Crossing subscribers, which rule 2 allows for configuration and for nothing else: what is
 * counted is asks for a test workspace, and nothing counted here says anything about a company
 * anybody verified.
 */
export async function countPendingSandboxRequests(operator: Queryable): Promise<number> {
  const { rows } = await operator.query<{ count: string }>(
    // As text, because count(*) is a bigint and `pg` hands those back as strings rather than
    // silently rounding them into a double.
    `SELECT count(*)::text AS count FROM sandbox_requests WHERE status = 'REQUESTED'`,
  );
  return Number(rows[0]?.count ?? '0');
}

/**
 * Every open ask, for the staff who answer them. Read on the operator connection.
 *
 * For the screen that lists them and answers them, which needs every column of every row. A
 * screen that needs only how many is served by `countPendingSandboxRequests` above, and must
 * not measure this list to get there.
 *
 * Crossing subscribers, which rule 2 allows for configuration and for nothing else: no column
 * read here says anything about a company anybody verified.
 */
export async function listPendingSandboxRequests(
  operator: Queryable,
): Promise<PendingSandboxRequest[]> {
  const { rows } = await operator.query<
    SandboxRequestRow & {
      tenant_id: string;
      legal_name: string;
      slug: string;
      already_has_sandbox: boolean;
    }
  >(
    `SELECT r.id, r.status, r.requested_at, r.decided_at, r.sandbox_slug, r.refusal_code,
            r.tenant_id, t.legal_name, t.slug,
            EXISTS (SELECT 1 FROM tenants s WHERE s.sandbox_of = t.id) AS already_has_sandbox
     FROM sandbox_requests r
     JOIN tenants t ON t.id = r.tenant_id
     WHERE r.status = 'REQUESTED'
     ORDER BY r.requested_at`,
  );

  return rows.map((row) => ({
    ...toRequest(row),
    tenantId: row.tenant_id,
    tenantName: row.legal_name,
    tenantSlug: row.slug,
    alreadyHasSandbox: row.already_has_sandbox,
  }));
}

/**
 * The two connections making a sandbox needs, and why it needs two.
 *
 * The operator role may link a workspace to the one it is the sandbox of and put it on a plan,
 * and may do nothing else to a subscriber's data. Inserting the workspace row, creating the
 * person who will sign in to it and funding its wallet are writes to a subscriber's own tables,
 * which belong on the application connection under that workspace's own row level security.
 * The same split `confirmTopUpAction` makes, for the same reason.
 */
export interface SandboxProvisioner {
  /**
   * The operator connection with a transaction around it, which the caller supplies rather
   * than this file opening one: a pool satisfies `Queryable` and hands out a different
   * connection per statement, so a BEGIN written here would silently not be a transaction at
   * all.
   *
   * Every operator side statement of an answer runs inside it, the first read included. It
   * used to read the ask on a pooled connection and write the answer in a transaction opened
   * afterwards, and the gap between the two is where a second member of staff fits.
   */
  inOperatorTransaction: <T>(run: (db: Queryable) => Promise<T>) => Promise<T>;
  inTenant: <T>(tenantId: string, run: (tx: TenantTransaction) => Promise<T>) => Promise<T>;
}

export interface CreatedSandbox {
  requestId: string;
  tenantId: string;
  slug: string;
  legalName: string;
  /**
   * The person who asked, and the password that lets them in, which exists in plain text in
   * this return value and nowhere else (SEC-10). Null when the request carries no user, which
   * happens only for a request made outside a signed in session.
   */
  account: { email: string; temporaryPassword: string } | null;
}

/** Play money, so the billing path runs in the sandbox exactly as it does in production. */
const SANDBOX_CREDIT_HALALAS = 1_000_000_00;

/**
 * Make the sandbox this request asked for.
 *
 * Deliberately a decision somebody takes rather than something that happens on the click.
 * Making one is provisioning a second workspace: it is placed on a plan, funded, and given a
 * person who can sign in to it, and it consumes the platform's own sandbox credential at the
 * data source. None of that is a subscriber's to grant themselves, which is exactly why the
 * database gives the `sandbox_of` grant to the operator role alone. What the click does is
 * everything after the decision, in one go, so the answer costs a member of staff one press
 * rather than a shell and a provisioning script.
 *
 * **The ask is locked before anything is made.** The order alone does not protect this, and
 * the comment that said it did was wrong. Reading the ask on a pooled connection and opening
 * the operator transaction afterwards leaves a gap: one member of staff presses «أنشئ» while
 * another presses «أكّد أنها لا تُنشأ» on the same row, the workspace, its person and its
 * wallet all commit, and then `UPDATE ... AND status = 'REQUESTED'` matches nothing and rolls
 * the operator transaction back. What is left is a workspace linked to nobody, on no screen,
 * holding the slug this subscriber's sandbox will want. The next attempt fails on that slug
 * for as long as the row exists, so the gap does not cost one press, it costs the feature.
 *
 * So the first statement takes the row with `FOR UPDATE`, inside the transaction that will
 * answer it, and holds it until the answer commits. A second answer on the same row waits
 * there and then finds the ask closed, which is exactly what it should find.
 *
 * The rest of the order still matters. The plan is read before anything is created, because
 * it is the one precondition that lives outside this workspace and discovering it missing
 * afterwards would mean a committed workspace and nothing to undo it with. The workspace is
 * inserted suspended and opened last, so what the operator transaction commits is a workspace
 * that is whole. What remains, and is said rather than hidden: the workspace commits on the
 * subscriber's connection while the operator transaction is still open, so a crash between
 * the two commits still leaves that suspended row behind. Two connections cannot be one
 * transaction, and the answer to that is a sweep, not a comment claiming it cannot happen.
 */
export async function createSandboxForRequest(
  provision: SandboxProvisioner,
  actor: OperatorIdentity,
  input: { requestId: string },
): Promise<CreatedSandbox> {
  assertSubscribers(actor);
  const { inTenant } = provision;

  const made = await provision.inOperatorTransaction(async (db): Promise<CreatedSandbox> => {
    const { rows: asked } = await db.query<{
      tenant_id: string;
      legal_name: string;
      slug: string;
      requested_by: string | null;
      parent_is_sandbox: boolean;
      already_has_sandbox: boolean;
    }>(
      `SELECT r.tenant_id, t.legal_name, t.slug, r.requested_by,
              (t.sandbox_of IS NOT NULL) AS parent_is_sandbox,
              EXISTS (SELECT 1 FROM tenants s WHERE s.sandbox_of = t.id) AS already_has_sandbox
       FROM sandbox_requests r
       JOIN tenants t ON t.id = r.tenant_id
       WHERE r.id = $1 AND r.status = 'REQUESTED'
       FOR UPDATE OF r`,
      [input.requestId],
    );

    const request = asked[0];
    if (!request) {
      throw new NxError('NX-4041', { detail: 'no open request with that id' });
    }
    if (request.parent_is_sandbox) {
      throw new NxError('NX-4091', { detail: 'a sandbox workspace cannot own another sandbox' });
    }
    if (request.already_has_sandbox) {
      throw new NxError('NX-4091', { detail: 'this workspace already has a sandbox' });
    }

    // Read now rather than at the end. A sandbox is placed on the SANDBOX plan, and a
    // deployment without that plan can make no sandbox at all: finding out after the
    // workspace has committed would leave the row this function exists to avoid leaving.
    const { rows: plan } = await db.query<{ code: string }>(
      `SELECT code FROM packages WHERE code = 'SANDBOX'`,
    );
    if (!plan[0]) {
      throw new NxError('NX-5001', { detail: 'the SANDBOX plan is not defined in this database' });
    }

    const sandboxId = randomUUID();
    const legalName = `${request.legal_name} (Sandbox)`;
    const slug = sandboxSlug(request.slug);
    const password = randomBytes(18).toString('base64url');

    // Whoever asked is who gets in. Read on the subscriber's own connection, because the
    // operator role holds nothing on `users` and must not: that table is people, not commerce.
    const requester =
      request.requested_by === null
        ? null
        : await inTenant(request.tenant_id, async (tx) => {
            const { rows } = await tx.query<{ email: string; display_name: string }>(
              `SELECT email, display_name FROM users
               WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
              [tx.tenantId, request.requested_by],
            );
            return rows[0] ?? null;
          });

    // One transaction: the workspace, the person in it, and its play money together, or none.
    await inTenant(sandboxId, async (tx) => {
      await tx
        .query(
          `INSERT INTO tenants (id, legal_name, slug, status) VALUES ($1, $2, $3, 'suspended')`,
          [sandboxId, legalName, slug],
        )
        .catch((error: unknown) => {
          if (isUniqueViolation(error)) {
            // Not a 4091 alongside the two above it. Both of those were already checked, so a
            // taken name here means the slug belongs to something that is not this
            // subscriber's sandbox: two workspaces whose names agree for the first 55
            // characters, or the remains of an attempt that committed this workspace and then
            // lost its connection before it was linked. Neither is anything the person
            // pressing the button can resolve, and neither is «they already have one».
            throw new NxError('NX-5001', {
              detail: 'the sandbox workspace name is already taken',
              cause: error,
            });
          }
          throw error;
        });

      if (requester) {
        const userId = await createUser(
          tx,
          { email: requester.email, displayName: requester.display_name, role: 'ADMIN' },
          actor.id,
        );
        // Temporary by construction, as every account this platform creates is: the person
        // changes it on first sign in, so nobody who handed it over knows it afterwards.
        await setPassword(tx, { userId, password, mustChange: true, actorId: actor.id });
      }

      // No invoice id, because there is no invoice: nobody was billed for play money. The
      // column's own rule (ADR-166) is that a value there claims a tax invoice exists, and a
      // sandbox statement printing «SANDBOX» in the invoice column claims one that does not.
      await topUp(tx, { amount: SANDBOX_CREDIT_HALALAS, vatInvoiceId: null });
    });

    await db.query(`UPDATE tenants SET sandbox_of = $2 WHERE id = $1`, [
      sandboxId,
      request.tenant_id,
    ]);

    // Every module on and no capacity, from the plan's own row rather than from numbers
    // written here, so a sandbox keeps matching what SANDBOX means as that plan changes.
    const planned = await db.query(
      `INSERT INTO tenant_commitments (tenant_id, package_code, term_months,
                                       credits_granted_halalas, setup_fee_halalas,
                                       included_transactions, platform_fee_halalas)
       SELECT $1, p.code, p.term_months, 0, 0, p.included_transactions, 0
       FROM packages p WHERE p.code = 'SANDBOX'`,
      [sandboxId],
    );
    // INSERT ... SELECT writes nothing and reports success when the plan is not there, and a
    // workspace with no commitment is entitled to no product at all. Said out loud, because
    // the screen that follows this call tells the subscriber they are on the sandbox plan.
    if (planned.rowCount !== 1) {
      throw new NxError('NX-5001', { detail: 'the SANDBOX plan is not defined in this database' });
    }

    const { rowCount } = await db.query(
      `UPDATE sandbox_requests
       SET status = 'CREATED', decided_by = $2, decided_at = now(),
           sandbox_tenant_id = $3, sandbox_slug = $4
       WHERE id = $1 AND status = 'REQUESTED'`,
      [input.requestId, actor.id, sandboxId, slug],
    );
    if (rowCount !== 1) {
      // Unreachable while the lock above is held, and kept for the day somebody moves that
      // lock: the guard is cheap and the thing it guards is a subscriber's workspace.
      throw new NxError('NX-4091', { detail: 'that request was already answered' });
    }

    await recordOperatorAudit(db, {
      operatorId: actor.id,
      action: 'subscribers.sandbox_created',
      target: `subscriber:${request.tenant_id}`,
      metadata: { request_id: input.requestId, sandbox_tenant_id: sandboxId, slug },
    });

    // And in the subscriber's own trail, because «who gave us a test workspace, and when» is
    // a question they ask about their own account.
    await db.query(
      `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target, metadata)
       VALUES ($1, 'NX_STAFF', $2, 'sandbox.created', $3, $4::jsonb)`,
      [
        request.tenant_id,
        actor.id,
        input.requestId,
        JSON.stringify({ sandbox_tenant_id: sandboxId, slug }),
      ],
    );

    return {
      requestId: input.requestId,
      tenantId: sandboxId,
      slug,
      legalName,
      account: requester ? { email: requester.email, temporaryPassword: password } : null,
    };
  });

  // Opened only now, so nothing above can leave a workspace that is reachable but half made.
  await inTenant(made.tenantId, (tx) =>
    tx.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [made.tenantId]),
  );

  return made;
}

/**
 * Answering no.
 *
 * Recorded rather than deleted, so the subscriber's screen can say that somebody looked and
 * decided, which is a different thing from a button that did nothing.
 */
export async function refuseSandboxRequest(
  operator: Queryable,
  actor: OperatorIdentity,
  input: { requestId: string; code: SandboxRefusalCode },
): Promise<void> {
  assertSubscribers(actor);
  const { rows } = await operator.query<{ tenant_id: string }>(
    `UPDATE sandbox_requests
     SET status = 'REFUSED', decided_by = $2, decided_at = now(), refusal_code = $3
     WHERE id = $1 AND status = 'REQUESTED'
     RETURNING tenant_id`,
    [input.requestId, actor.id, input.code],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', { detail: 'no open request with that id' });
  }

  await recordOperatorAudit(operator, {
    operatorId: actor.id,
    action: 'subscribers.sandbox_refused',
    target: `subscriber:${row.tenant_id}`,
    metadata: { request_id: input.requestId, reason: input.code },
  });

  await operator.query(
    `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target, metadata)
     VALUES ($1, 'NX_STAFF', $2, 'sandbox.refused', $3, $4::jsonb)`,
    [row.tenant_id, actor.id, input.requestId, JSON.stringify({ reason: input.code })],
  );
}

/** The panel's own gate: only the roles that manage subscribers answer these asks. */
function assertSubscribers(actor: OperatorIdentity): void {
  if (!operatorCan(actor.role, 'subscribers')) {
    throw new NxError('NX-4031', { detail: 'this role does not change subscribers' });
  }
}

/**
 * The sandbox's workspace name: the real one with a suffix, inside what the slug check allows.
 *
 * Truncated from the left of the suffix rather than the right, because the suffix is the part
 * that has to survive: two workspaces called `a-very-long-name` and `a-very-long-name` tell
 * nobody which one is the test.
 */
function sandboxSlug(parentSlug: string): string {
  const suffix = '-sandbox';
  const head = parentSlug.slice(0, 63 - suffix.length).replace(/-+$/, '');
  return `${head}${suffix}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
  );
}
