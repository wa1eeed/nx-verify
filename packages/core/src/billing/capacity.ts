import type { Queryable } from '@nx-verify/db';
import { riyalsToHalalas } from './money.js';

/**
 * How much a workspace can actually spend, in one place (ADR-162).
 *
 * This platform pays for a verification in an order: the plan's included transactions while
 * they last, then an operation from a prepaid bundle, then riyals from the wallet at the
 * listed price. `verify()` has always implemented that order correctly.
 *
 * Everything that *reports* on it did not. The rule «are they low on credit» was written five
 * separate times, in `wallet.ts`, in `dashboard.ts`, in `subscribers.ts`, in
 * `service-health.ts`, and once as inline SQL in `inbox.ts`, and every one of them read the
 * wallet alone. So a subscriber holding five thousand bundle operations and an empty wallet
 * was told on five screens that they were out of money, emailed that their verifications were
 * about to stop, listed for staff as needing attention, and hard refused from a batch they
 * could have paid for twice over.
 *
 * One reading, one predicate, and every one of those screens asks it. A sixth copy is the
 * failure this module exists to prevent.
 *
 * What it is not: a replacement for the wallet in riyals. A statement, a top up and an
 * integrator reconciling payments all mean the wallet specifically, and they should keep
 * saying so. What this answers is the different question of whether work can run.
 */

/**
 * Operations at or under this share of what was bought are a low balance.
 *
 * A fifth, which is the figure the subscribers board has used since it was built. Moved here
 * rather than restated, so the board and every screen that now asks this module agree by
 * construction instead of by coincidence.
 */
export const LOW_OPERATIONS_SHARE = 0.2;

export interface SpendCapacity {
  /** Transactions left in the plan, or null when there is no plan with a limit. */
  planLeft: number | null;
  /** Operations left on live bundles. */
  bundleOperations: number;
  /** Operations bought, for judging what «low» means against. */
  operationsBought: number;
  /** Riyals available in the wallet, in halalas. */
  walletAvailableHalalas: number;
  /** True when the wallet alone is low, by the wallet's own threshold. */
  walletIsLow: boolean;
}

/**
 * Operations that cost nothing further to run: the plan's remainder plus live bundles.
 *
 * Null only when there is neither a plan with a limit nor any bundle, which is the pure pay as
 * you go case where the wallet is the whole answer.
 */
export function operationsLeft(capacity: SpendCapacity): number | null {
  if (capacity.planLeft === null && capacity.bundleOperations === 0) {
    return null;
  }
  return (capacity.planLeft ?? 0) + capacity.bundleOperations;
}

/**
 * Can this workspace run a verification at all.
 *
 * The question every «you have no balance» message should have been asking. Any of the three
 * answers yes.
 */
export function canSpend(capacity: SpendCapacity): boolean {
  return (
    (capacity.planLeft ?? 0) > 0 ||
    capacity.bundleOperations > 0 ||
    capacity.walletAvailableHalalas > 0
  );
}

/**
 * Is this workspace low on credit.
 *
 * Operations decide it whenever there are any, because a workspace on a plan or a bundle does
 * not spend the wallet at all and its riyal balance says nothing about whether work will stop.
 * The wallet's own threshold answers only for a workspace with neither.
 */
export function isLowOnCredit(capacity: SpendCapacity): boolean {
  const left = operationsLeft(capacity);
  if (left === null) {
    return capacity.walletIsLow;
  }
  if (capacity.operationsBought > 0) {
    return left <= capacity.operationsBought * LOW_OPERATIONS_SHARE;
  }
  // Operations exist but nothing is recorded as bought, so the only honest reading is
  // whether any are left.
  return left === 0 && capacity.walletIsLow;
}

/**
 * Every figure the predicates need, in one query.
 *
 * Deliberately one read rather than three calls: a screen asking «can they spend» three times
 * in three ways is how the five copies happened.
 */
export async function spendCapacity(db: Queryable, tenantId: string): Promise<SpendCapacity> {
  const { rows } = await db.query<{
    plan_left: string | null;
    bundle_operations: string;
    operations_bought: string;
    wallet_available: string;
    wallet_is_low: boolean;
  }>(
    `WITH plan AS (
       SELECT CASE
                WHEN c.included_transactions IS NULL THEN NULL
                ELSE greatest(0, c.included_transactions - c.transactions_used)
              END AS plan_left,
              COALESCE(c.included_transactions, 0) AS plan_bought
         FROM tenant_commitments c
        WHERE c.tenant_id = $1 AND c.status = 'active'
        LIMIT 1
     ),
     bundles AS (
       -- The same window bundleBalance uses: unspent, and not lapsed.
       SELECT COALESCE(sum(g.operations - g.used), 0) AS operations,
              COALESCE(sum(g.operations), 0) AS granted
         FROM bundle_grants g
        WHERE g.tenant_id = $1 AND g.used < g.operations AND g.expires_at > now()
     ),
     w AS (
       SELECT balance, held, low_threshold FROM wallets WHERE tenant_id = $1
     )
     SELECT (SELECT plan_left FROM plan)::text AS plan_left,
            (SELECT operations FROM bundles)::text AS bundle_operations,
            (COALESCE((SELECT plan_bought FROM plan), 0)
              + COALESCE((SELECT granted FROM bundles), 0))::text AS operations_bought,
            -- The wallet stores riyals, not halalas: every other reader converts, and a
            -- reading that forgets is out by a hundred.
            COALESCE((SELECT balance - held FROM w), 0)::text AS wallet_available,
            COALESCE(
              (SELECT balance > 0 AND (balance - held) <= (balance * low_threshold) FROM w),
              false
            ) AS wallet_is_low`,
    [tenantId],
  );

  const row = rows[0];
  return {
    planLeft: row?.plan_left == null ? null : Number(row.plan_left),
    bundleOperations: Number(row?.bundle_operations ?? '0'),
    operationsBought: Number(row?.operations_bought ?? '0'),
    walletAvailableHalalas: riyalsToHalalas(row?.wallet_available ?? '0'),
    walletIsLow: row?.wallet_is_low ?? false,
  };
}
