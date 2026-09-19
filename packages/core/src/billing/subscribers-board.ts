import { randomBytes, randomUUID } from 'node:crypto';
import { LOW_OPERATIONS_SHARE } from './capacity.js';
import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { createUser } from '../auth/users.js';
import { setPassword } from '../auth/passwords.js';
import { recordOperatorAudit } from '../operators/audit.js';
import { operatorCan, type OperatorIdentity } from '../operators/accounts.js';
import { platformRevenue, type RevenueBreakdown } from './margin.js';
import { setTenantPackage } from './package-admin.js';
import { listSubscriberSummaries, type SubscriberSummary } from './subscribers.js';

/**
 * The subscribers and their balances (handoff screen 06, «المشتركون والأرصدة»).
 *
 * One row per paying subscriber: the plan, what is left to spend, when the term ends, how much
 * was used in thirty days, whether a special price applies, and where the subscriber stands.
 * Above them, four figures: the month's revenue against last month's, the month's operations,
 * the operations bought and not yet spent across everybody, and how many subscribers need
 * somebody to act.
 *
 * Every figure is commercial and comes from the commitment, the wallet, the bundles, the
 * transfers and the monthly counters, never from a run or an attestation (rule 2). Read on
 * the operator connection, and sandbox workspaces are not subscribers.
 */

/** A term ending within this many days is shown as ending soon (screen 06). */
export const EXPIRING_WINDOW_DAYS = 14;


export type SubscriberStanding = 'ACTIVE' | 'LOW_BALANCE' | 'EXPIRING' | 'SUSPENDED';

export interface SubscriberBoardRow extends SubscriberSummary {
  /** Operations left in bundles that have not lapsed. */
  bundleOperations: number;
  /** Operations those unlapsed bundles were bought with, spent or not. */
  bundleGranted: number;
  /** The largest bundle held, for a subscriber who pays by bundles alone. */
  largestBundle: number | null;
  /** Package and bundle operations together; null when the wallet in riyals is the limit. */
  operationsLeft: number | null;
  /** What those operations were bought as: the package's included plus the bundles. */
  operationsBought: number;
  runs30: number;
  hasSpecialPrice: boolean;
  standing: SubscriberStanding;
}

export interface SubscribersBoard {
  rows: SubscriberBoardRow[];
  /** Subscribers who are not suspended. */
  active: number;
  expiringSoon: number;
  revenue: {
    thisMonthHalalas: number;
    lastMonthHalalas: number;
    /** Whole percent against last month; null when last month earned nothing. */
    changePct: number | null;
    lastMonthStart: Date;
    /**
     * The same two figures, by the mechanism that produced them.
     *
     * The totals above are one number each, and one number cannot be argued with. A month
     * where the wallets were quiet and two plans renewed is a different month from one where
     * the wallets carried it, and the screen can only say so if it is handed the parts.
     */
    thisMonth: RevenueBreakdown;
    lastMonth: RevenueBreakdown;
  };
  runsThisMonth: number;
  unconsumedOperations: number;
  needsAction: number;
}

/** Where a subscriber stands, from the facts on its row. The first that applies wins. */
export function standingOf(row: {
  status: string | null;
  billingModel: string | null;
  daysLeft: number | null;
  operationsLeft: number | null;
  operationsBought: number;
  lowBalance: boolean;
}): SubscriberStanding {
  // A plan paid per operation has no term to lapse; every other plan does.
  const dated = row.billingModel !== 'PAYG';
  if (
    row.status === null ||
    row.status === 'suspended' ||
    row.status === 'cancelled' ||
    (dated && row.daysLeft !== null && row.daysLeft < 0)
  ) {
    return 'SUSPENDED';
  }
  if (dated && row.daysLeft !== null && row.daysLeft <= EXPIRING_WINDOW_DAYS) {
    return 'EXPIRING';
  }
  const low =
    row.operationsLeft !== null && row.operationsBought > 0
      ? row.operationsLeft <= row.operationsBought * LOW_OPERATIONS_SHARE
      : row.lowBalance;
  return low ? 'LOW_BALANCE' : 'ACTIVE';
}

function monthStart(at: Date, offset = 0): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + offset, 1));
}

function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * What subscribers paid for in a month, before VAT: runs the wallet was charged for, bundles
 * whose transfer was confirmed, and the month's share of each plan's fee. A run a package or a
 * bundle covered earned nothing that month; its money was counted when it was paid.
 *
 * The three sums live in `platformRevenue` (margin.ts) rather than here, because this board and
 * the panel's own revenue tile were answering the same question with different arithmetic, and
 * the figure an owner is asked to trust cannot depend on which screen they opened.
 */

export async function subscribersBoard(
  operator: Queryable,
  options: { now?: Date } = {},
): Promise<SubscribersBoard> {
  const now = options.now ?? new Date();
  const summaries = await listSubscriberSummaries(operator, { now });

  const { rows: grants } = await operator.query<{
    tenant_id: string;
    left: string | null;
    granted: string;
    largest: number;
  }>(
    `SELECT tenant_id,
            sum(operations - used)::text AS left,
            sum(operations)::text AS granted,
            max(operations) AS largest
     FROM bundle_grants
     WHERE expires_at > $1
     GROUP BY tenant_id`,
    [now],
  );
  const bundlesOf = new Map(grants.map((row) => [row.tenant_id, row]));

  const { rows: special } = await operator.query<{ id: string }>(
    `SELECT t.id FROM tenants t
     WHERE EXISTS (SELECT 1 FROM tenant_product_overrides o
                   WHERE o.tenant_id = t.id AND o.unit_price_halalas IS NOT NULL)
        OR EXISTS (SELECT 1 FROM tenant_price_discounts d WHERE d.tenant_id = t.id)`,
  );
  const specialPrices = new Set(special.map((row) => row.id));

  // Thirty days are this month and the part of last month that falls inside them, in
  // proportion, because the counters count by month.
  const thisMonth = monthStart(now);
  const lastMonth = monthStart(now, -1);
  const daysThisMonth = (now.getTime() - thisMonth.getTime()) / 86_400_000;
  const daysLastMonth = (thisMonth.getTime() - lastMonth.getTime()) / 86_400_000;
  const share = Math.max(0, Math.min(1, (30 - daysThisMonth) / daysLastMonth));
  // The month as text: a date column read into a JavaScript Date lands on local midnight, which
  // east of Greenwich is the last day of the month before.
  const { rows: counters } = await operator.query<{
    tenant_id: string;
    period_start: string;
    runs: string;
  }>(
    `SELECT tenant_id, period_start::text AS period_start, sum(runs)::text AS runs
     FROM margin_counters
     WHERE period_start >= $1::date
     GROUP BY tenant_id, period_start`,
    [isoDay(lastMonth)],
  );
  const runs30 = new Map<string, number>();
  let runsThisMonth = 0;
  for (const counter of counters) {
    const current = counter.period_start >= isoDay(thisMonth);
    const runs = Number(counter.runs);
    runs30.set(
      counter.tenant_id,
      (runs30.get(counter.tenant_id) ?? 0) + runs * (current ? 1 : share),
    );
    if (current && summaries.some((row) => row.tenantId === counter.tenant_id)) {
      runsThisMonth += runs;
    }
  }

  const rows = summaries.map((summary): SubscriberBoardRow => {
    const bundle = bundlesOf.get(summary.tenantId);
    const bundleOperations = Number(bundle?.left ?? 0);
    const bundleGranted = Number(bundle?.granted ?? 0);
    const counted = summary.transactionsLeft !== null || bundleGranted > 0;
    const operationsLeft = counted ? (summary.transactionsLeft ?? 0) + bundleOperations : null;
    const operationsBought = (summary.includedTransactions ?? 0) + bundleGranted;
    const facts = {
      ...summary,
      bundleOperations,
      bundleGranted,
      largestBundle: bundle?.largest ?? null,
      operationsLeft,
      operationsBought,
      runs30: Math.round(runs30.get(summary.tenantId) ?? 0),
      hasSpecialPrice: specialPrices.has(summary.tenantId),
    };
    return { ...facts, standing: standingOf(facts) };
  });

  const [thisRevenue, lastRevenue] = [
    await platformRevenue(operator, thisMonth, monthStart(now, 1)),
    await platformRevenue(operator, lastMonth, thisMonth),
  ];
  const thisMonthHalalas = thisRevenue.totalHalalas;
  const lastMonthHalalas = lastRevenue.totalHalalas;

  return {
    rows,
    active: rows.filter((row) => row.standing !== 'SUSPENDED').length,
    expiringSoon: rows.filter((row) => row.standing === 'EXPIRING').length,
    revenue: {
      thisMonthHalalas,
      lastMonthHalalas,
      changePct:
        lastMonthHalalas === 0
          ? null
          : Math.round(((thisMonthHalalas - lastMonthHalalas) / lastMonthHalalas) * 100),
      lastMonthStart: lastMonth,
      thisMonth: thisRevenue,
      lastMonth: lastRevenue,
    },
    runsThisMonth,
    unconsumedOperations: rows
      .filter((row) => row.standing !== 'SUSPENDED')
      .reduce((total, row) => total + (row.operationsLeft ?? 0), 0),
    needsAction: rows.filter((row) => row.standing !== 'ACTIVE').length,
  };
}

// ── changing a subscriber ─────────────────────────────────────────────────────────────────

function assertSubscribers(actor: OperatorIdentity): void {
  if (!operatorCan(actor.role, 'subscribers')) {
    throw new NxError('NX-4031', { detail: 'this role does not change subscribers' });
  }
}

export interface NewSubscriberInput {
  legalName: string;
  /** The workspace name the subscriber's staff sign in with. */
  slug: string;
  adminEmail: string;
  adminName?: string | undefined;
  packageCode: string;
}

export interface NewSubscriber {
  tenantId: string;
  slug: string;
  adminEmail: string;
  /** Shown once to the member of staff who made it, and asked to be changed at first sign in. */
  temporaryPassword: string;
}

/**
 * «مشترك جديد»: a workspace, its first administrator, and its plan.
 *
 * The workspace and its administrator are written under the new subscriber's own scope on the
 * application connection, the only way a tenant row is created without a role that crosses
 * subscribers. The plan is set on the operator connection, because a subscriber never chooses
 * the plan it runs on. The administrator's password is temporary by construction.
 */
export async function createSubscriber(
  inTenant: <T>(tenantId: string, handler: (tx: TenantTransaction) => Promise<T>) => Promise<T>,
  operator: Queryable,
  actor: OperatorIdentity,
  input: NewSubscriberInput,
): Promise<NewSubscriber> {
  assertSubscribers(actor);
  const legalName = input.legalName.trim();
  const slug = input.slug.trim().toLowerCase();
  const adminEmail = input.adminEmail.trim().toLowerCase();
  if (legalName.length < 2 || legalName.length > 120) {
    throw new NxError('NX-4002', { detail: 'a legal name is 2 to 120 characters' });
  }
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
    throw new NxError('NX-4002', {
      detail: 'a workspace name is 3 to 40 lowercase letters, digits and hyphens',
    });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail) || adminEmail.length > 200) {
    throw new NxError('NX-4002', { detail: 'the administrator email is malformed' });
  }
  const { rows: plans } = await operator.query<{ code: string }>(
    `SELECT code FROM packages WHERE code = $1 AND status = 'active' AND code <> 'SANDBOX'`,
    [input.packageCode],
  );
  if (plans.length === 0) {
    throw new NxError('NX-4041', { detail: 'no such plan on offer' });
  }
  const { rows: taken } = await operator.query(`SELECT 1 FROM tenants WHERE slug = $1`, [slug]);
  if (taken.length > 0) {
    throw new NxError('NX-4091', { detail: 'a workspace with this name exists' });
  }

  const tenantId = randomUUID();
  const temporaryPassword = randomBytes(18).toString('base64url');
  try {
    await inTenant(tenantId, async (tx) => {
      await tx.query(`INSERT INTO tenants (id, legal_name, slug) VALUES ($1, $2, $3)`, [
        tenantId,
        legalName,
        slug,
      ]);
      const userId = await createUser(
        tx,
        { email: adminEmail, displayName: input.adminName?.trim() || adminEmail, role: 'ADMIN' },
        actor.id,
      );
      await setPassword(tx, {
        userId,
        password: temporaryPassword,
        mustChange: true,
        actorId: actor.id,
      });
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new NxError('NX-4091', { detail: 'a workspace with this name exists' });
    }
    throw error;
  }

  await setTenantPackage(operator, { tenantId, packageCode: input.packageCode }, actor.id);
  await recordOperatorAudit(operator, {
    operatorId: actor.id,
    action: 'subscribers.created',
    target: `subscriber:${tenantId}`,
    metadata: { package: input.packageCode },
  });
  return { tenantId, slug, adminEmail, temporaryPassword };
}

/**
 * Stops a subscriber's verifications, or lets them run again. Their data, balance and bundles
 * are untouched: a suspended subscriber is refused a run (SUBSCRIPTION_INACTIVE), not erased.
 */
export async function setSubscriberSuspended(
  operator: Queryable,
  actor: OperatorIdentity,
  tenantId: string,
  suspended: boolean,
): Promise<void> {
  assertSubscribers(actor);
  const { rowCount } = await operator.query(
    `UPDATE tenant_commitments SET status = $2, updated_at = now()
     WHERE tenant_id = $1 AND status <> $2 AND status IN ('trial', 'active', 'suspended')`,
    [tenantId, suspended ? 'suspended' : 'active'],
  );
  if ((rowCount ?? 0) > 0) {
    await recordOperatorAudit(operator, {
      operatorId: actor.id,
      action: suspended ? 'subscribers.suspended' : 'subscribers.resumed',
      target: `subscriber:${tenantId}`,
    });
  }
}

/** Moves a subscriber onto a plan, from the panel, recorded against the person who did it. */
export async function assignSubscriberPlan(
  operator: Queryable,
  actor: OperatorIdentity,
  tenantId: string,
  packageCode: string,
): Promise<void> {
  assertSubscribers(actor);
  const { from } = await setTenantPackage(operator, { tenantId, packageCode }, actor.id);
  await recordOperatorAudit(operator, {
    operatorId: actor.id,
    action: 'subscribers.plan',
    target: `subscriber:${tenantId}`,
    // What they were moved off, not only what onto. A move between two plans is the largest
    // change a member of staff can make to an account, and half of it was not being recorded.
    metadata: { package: packageCode, from },
  });
}
