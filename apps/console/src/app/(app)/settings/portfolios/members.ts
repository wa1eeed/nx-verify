import type { TenantTransaction } from '@nx-verify/db';

/**
 * What the groups screen needs in order to show a membership (ADR-176).
 *
 * Two reads shaped for one table, kept beside the screen that asks for them, the way this
 * page already reads its own per group durations. The writes are the domain's and stay
 * there: `addToPortfolio` and `removeFromPortfolio` decide what a membership does to a
 * customer's monitoring, and nothing here decides anything.
 *
 * One piece of domain knowledge does leak in: a monitor started by a membership carries
 * `portfolio:<id>` as its consent, and the join below reads that string. It is written in
 * `packages/core/src/portfolios/portfolios.ts` and should be read back through a function
 * exported from there rather than through a literal here.
 */

/** A monitor's state as the monitoring screen names it, or none for this membership. */
export type MemberMonitorStatus = 'active' | 'paused' | 'budget_exhausted';

export interface PortfolioMemberRow {
  portfolioId: string;
  entityId: string;
  displayName: string | null;
  /** The person who added them, when the account is still in this workspace. */
  addedByName: string | null;
  addedAt: Date;
  monitorStatus: MemberMonitorStatus | null;
}

export interface PortfolioMembers {
  /** The newest memberships, which is as many as this screen draws. */
  rows: PortfolioMemberRow[];
  /** How many there are in all, so a capped table says it is capped. */
  total: number;
}

/**
 * Every membership in this workspace, newest first.
 *
 * The monitor column comes from the monitor this membership started, found by the consent
 * it carries rather than by the customer: a customer watched from their own file for some
 * other reason is not this group's monitoring and must not be reported as if it were.
 *
 * Capped like the picker is, and the count of all of them comes back with the slice. A
 * table that silently stops at five hundred answers «من في هذه المجموعة» with a list that
 * is missing people, and «كم عضواً» with a number that is not the number.
 */
export async function readPortfolioMembers(
  tx: TenantTransaction,
  limit = 500,
): Promise<PortfolioMembers> {
  const { rows } = await tx.query<{
    portfolio_id: string;
    entity_id: string;
    display_name: string | null;
    added_by_name: string | null;
    added_at: Date;
    monitor_status: MemberMonitorStatus | null;
    total: string;
  }>(
    `SELECT m.portfolio_id, m.entity_id, e.display_name, m.added_at,
            u.display_name AS added_by_name, mon.status AS monitor_status,
            count(*) OVER ()::text AS total
     FROM portfolio_members m
     JOIN entities e ON e.tenant_id = m.tenant_id AND e.id = m.entity_id
     LEFT JOIN users u ON u.tenant_id = m.tenant_id AND u.id::text = m.added_by
     LEFT JOIN LATERAL (
       SELECT mo.status
       FROM monitors mo
       WHERE mo.tenant_id = m.tenant_id
         AND mo.entity_id = m.entity_id
         AND mo.consent_ref = 'portfolio:' || m.portfolio_id::text
       ORDER BY mo.created_at DESC
       LIMIT 1
     ) mon ON true
     WHERE m.tenant_id = $1
     ORDER BY m.added_at DESC
     LIMIT $2`,
    [tx.tenantId, limit],
  );

  return {
    rows: rows.map((row) => ({
      portfolioId: row.portfolio_id,
      entityId: row.entity_id,
      displayName: row.display_name,
      addedByName: row.added_by_name,
      addedAt: row.added_at,
      monitorStatus: row.monitor_status,
    })),
    total: Number(rows[0]?.total ?? '0'),
  };
}

export interface CustomerChoice {
  entityId: string;
  displayName: string | null;
}

export interface MemberCandidates {
  /** The most recently seen customers, which is what the picker can hold. */
  choices: CustomerChoice[];
  /** How many there are in all, so the screen can say when it is showing a slice. */
  total: number;
}

/**
 * The customers a member can be chosen from.
 *
 * Customers, not entities. `entities` also holds the people and the accounts found inside
 * verifications, and the workspace's own record: a manager met inside a company check is a
 * row there with no name at all. Offering those under «العميل» put «عميل بلا اسم» in the
 * picker, and adding one to a watching group would have started a paid monitor re-running a
 * company product against a person, every cadence, until somebody noticed the bill.
 * `customer_standing` is the platform's own answer to who a customer is, and it is the same
 * table the customers list draws from, so one word means one thing on both screens.
 *
 * Capped, and the count comes back with the slice. A list of every customer a workspace has
 * ever verified is not a control anybody can use, and a picker that silently holds the first
 * few hundred is a screen quietly deciding that the rest do not exist.
 */
export async function readMemberCandidates(
  tx: TenantTransaction,
  limit = 200,
): Promise<MemberCandidates> {
  const { rows } = await tx.query<{
    id: string;
    display_name: string | null;
    total: string;
  }>(
    `SELECT e.id, e.display_name, count(*) OVER ()::text AS total
     FROM customer_standing s
     JOIN entities e ON e.tenant_id = s.tenant_id AND e.id = s.entity_id
     WHERE s.tenant_id = $1 AND e.archived_at IS NULL
     ORDER BY s.last_verified_at DESC NULLS LAST, e.id DESC
     LIMIT $2`,
    [tx.tenantId, limit],
  );

  return {
    choices: rows.map((row) => ({ entityId: row.id, displayName: row.display_name })),
    total: Number(rows[0]?.total ?? '0'),
  };
}
