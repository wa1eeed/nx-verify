import type { Queryable } from '@nx-verify/db';
import { riyalsToHalalas } from './money.js';

/**
 * The subscribers, as the people who run the platform need to see them.
 *
 * Three questions bring somebody to this screen: who is paying, when does their term run
 * out, and how much of what they bought is left. Every answer is commercial and none is
 * about a company a subscriber verified, so the sources are the commitment, the wallet,
 * the top up requests and the margin counter, and never a run or an attestation. Rule 2
 * allows a report across subscribers only from aggregated counters, and that is the shape
 * of every query here.
 *
 * Read on the operator connection. Sandbox workspaces are not subscribers: they belong to
 * one, and are shown as a property of it rather than as a second customer.
 */

const DAY_MS = 86_400_000;

/** How close to the end of a term a subscriber is shown as due for renewal. */
export const RENEWAL_WINDOW_DAYS = 30;

export interface SubscriberSummary {
  tenantId: string;
  legalName: string;
  slug: string;
  packageCode: string | null;
  packageNameAr: string | null;
  status: string | null;
  termStart: Date | null;
  termEnd: Date | null;
  /** Whole days until the term ends. Negative once it has ended, null without a term. */
  daysLeft: number | null;
  includedTransactions: number | null;
  transactionsUsed: number;
  /** Null when the package has no cap: the balance is then the only limit. */
  transactionsLeft: number | null;
  balanceHalalas: number;
  heldHalalas: number;
  availableHalalas: number;
  lowBalance: boolean;
  hasSandbox: boolean;
}

interface SubscriberRowData {
  id: string;
  legal_name: string;
  slug: string;
  package_code: string | null;
  package_name_ar: string | null;
  status: string | null;
  term_start: Date | null;
  term_end: Date | null;
  included_transactions: number | null;
  transactions_used: number | null;
  balance: string | null;
  held: string | null;
  low_threshold: string | null;
  has_sandbox: boolean;
}

const SUBSCRIBER_SELECT = `
  SELECT t.id, t.legal_name, t.slug,
         c.package_code, p.name_ar AS package_name_ar, c.status, c.term_start, c.term_end,
         c.included_transactions, c.transactions_used,
         w.balance::text AS balance, w.held::text AS held, w.low_threshold::text AS low_threshold,
         EXISTS (SELECT 1 FROM tenants s WHERE s.sandbox_of = t.id) AS has_sandbox
  FROM tenants t
  LEFT JOIN tenant_commitments c ON c.tenant_id = t.id
  LEFT JOIN packages p ON p.code = c.package_code
  LEFT JOIN wallets w ON w.tenant_id = t.id
  WHERE t.status = 'active' AND t.sandbox_of IS NULL`;

function toSummary(row: SubscriberRowData, now: Date): SubscriberSummary {
  const balance = row.balance === null ? 0 : riyalsToHalalas(row.balance);
  const held = row.held === null ? 0 : riyalsToHalalas(row.held);
  const threshold = row.low_threshold === null ? 0 : Number(row.low_threshold);
  const used = row.transactions_used ?? 0;

  return {
    tenantId: row.id,
    legalName: row.legal_name,
    slug: row.slug,
    packageCode: row.package_code,
    packageNameAr: row.package_name_ar,
    status: row.status,
    termStart: row.term_start,
    termEnd: row.term_end,
    // Floor, so a term ending this afternoon reads as zero days left rather than one.
    daysLeft:
      row.term_end === null ? null : Math.floor((row.term_end.getTime() - now.getTime()) / DAY_MS),
    includedTransactions: row.included_transactions,
    transactionsUsed: used,
    transactionsLeft:
      row.included_transactions === null ? null : Math.max(0, row.included_transactions - used),
    balanceHalalas: balance,
    heldHalalas: held,
    availableHalalas: balance - held,
    // The same rule the subscriber's own screen uses, so the two never disagree about
    // whether a balance is low.
    lowBalance: balance > 0 && balance - held <= balance * threshold,
    hasSandbox: row.has_sandbox,
  };
}

export async function listSubscriberSummaries(
  operator: Queryable,
  options: { now?: Date } = {},
): Promise<SubscriberSummary[]> {
  const now = options.now ?? new Date();
  const { rows } = await operator.query<SubscriberRowData>(
    `${SUBSCRIBER_SELECT} ORDER BY t.legal_name`,
  );
  return rows.map((row) => toSummary(row, now));
}

export interface ProductUsage {
  productCode: string;
  productNameAr: string;
  runs: number;
  packageRuns: number;
  billedHalalas: number;
  costHalalas: number;
}

export interface SubscriberTopUp {
  reference: string;
  amountHalalas: number;
  status: 'REQUESTED' | 'CONFIRMED' | 'REJECTED';
  requestedAt: Date;
  settledAt: Date | null;
}

export interface SubscriberDetail extends SubscriberSummary {
  createdAt: Date;
  platformFeeHalalas: number;
  /** Usage since the term started, by service, from the counters. */
  usage: ProductUsage[];
  topUps: SubscriberTopUp[];
}

export async function getSubscriberDetail(
  operator: Queryable,
  tenantId: string,
  options: { now?: Date } = {},
): Promise<SubscriberDetail | null> {
  const now = options.now ?? new Date();
  const { rows } = await operator.query<
    SubscriberRowData & { created_at: Date; platform_fee_halalas: number | null }
  >(
    `SELECT s.*, t.created_at, c.platform_fee_halalas
     FROM (${SUBSCRIBER_SELECT} AND t.id = $1) s
     JOIN tenants t ON t.id = s.id
     LEFT JOIN tenant_commitments c ON c.tenant_id = s.id`,
    [tenantId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }

  // Counted from the start of the term when there is one, and from the start of this
  // month otherwise: a figure with no period is a figure nobody can check.
  const since = row.term_start ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const { rows: usage } = await operator.query<{
    product_code: string;
    name_ar: string | null;
    runs: string;
    package_runs: string;
    billed: string;
    cost: string;
  }>(
    `SELECT m.product_code, pr.name_ar,
            sum(m.runs)::text AS runs, sum(m.package_runs)::text AS package_runs,
            sum(m.billed_halalas)::text AS billed, sum(m.provider_cost_halalas)::text AS cost
     FROM margin_counters m
     LEFT JOIN products pr ON pr.code = m.product_code
     WHERE m.tenant_id = $1 AND m.period_start >= date_trunc('month', $2::timestamptz)::date
     GROUP BY m.product_code, pr.name_ar
     ORDER BY sum(m.runs) DESC, m.product_code`,
    [tenantId, since],
  );

  const { rows: topUps } = await operator.query<{
    reference: string;
    amount: string;
    status: SubscriberTopUp['status'];
    requested_at: Date;
    settled_at: Date | null;
  }>(
    `SELECT reference, amount::text AS amount, status, requested_at, settled_at
     FROM topup_requests
     WHERE tenant_id = $1
     ORDER BY requested_at DESC
     LIMIT 20`,
    [tenantId],
  );

  return {
    ...toSummary(row, now),
    createdAt: row.created_at,
    platformFeeHalalas: row.platform_fee_halalas ?? 0,
    usage: usage.map((line) => ({
      productCode: line.product_code,
      productNameAr: line.name_ar ?? line.product_code,
      runs: Number(line.runs),
      packageRuns: Number(line.package_runs),
      billedHalalas: Number(line.billed),
      costHalalas: Number(line.cost),
    })),
    topUps: topUps.map((line) => ({
      reference: line.reference,
      amountHalalas: riyalsToHalalas(line.amount),
      status: line.status,
      requestedAt: line.requested_at,
      settledAt: line.settled_at,
    })),
  };
}

export interface PlatformOverview {
  subscribers: number;
  /** Terms ending within the renewal window, soonest first. */
  renewalsDue: SubscriberSummary[];
  /** Terms that have already ended while the commitment still reads active. */
  lapsed: SubscriberSummary[];
  lowBalance: SubscriberSummary[];
  /** Capacity nearly used: at least 80 percent of the included transactions. */
  nearCapacity: SubscriberSummary[];
  pendingTopUps: number;
  month: {
    runs: number;
    billedHalalas: number;
    costHalalas: number;
    /** Null when nothing was billed: a margin on no revenue is undefined, not zero. */
    marginPct: number | null;
  };
  busiest: { tenantId: string; legalName: string; runs: number; billedHalalas: number }[];
}

export async function platformOverview(
  operator: Queryable,
  options: { now?: Date } = {},
): Promise<PlatformOverview> {
  const now = options.now ?? new Date();
  const subscribers = await listSubscriberSummaries(operator, { now });

  const { rows: month } = await operator.query<{ runs: string; billed: string; cost: string }>(
    `SELECT coalesce(sum(runs), 0)::text AS runs,
            coalesce(sum(billed_halalas), 0)::text AS billed,
            coalesce(sum(provider_cost_halalas), 0)::text AS cost
     FROM margin_counters
     WHERE period_start = date_trunc('month', $1::timestamptz)::date`,
    [now],
  );

  const { rows: busiest } = await operator.query<{
    tenant_id: string;
    legal_name: string;
    runs: string;
    billed: string;
  }>(
    `SELECT m.tenant_id, t.legal_name, sum(m.runs)::text AS runs,
            sum(m.billed_halalas)::text AS billed
     FROM margin_counters m
     JOIN tenants t ON t.id = m.tenant_id
     WHERE m.period_start = date_trunc('month', $1::timestamptz)::date
       AND t.sandbox_of IS NULL
     GROUP BY m.tenant_id, t.legal_name
     ORDER BY sum(m.runs) DESC
     LIMIT 5`,
    [now],
  );

  const { rows: pending } = await operator.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM topup_requests WHERE status = 'REQUESTED'`,
  );

  const billed = Number(month[0]?.billed ?? 0);
  const cost = Number(month[0]?.cost ?? 0);

  return {
    subscribers: subscribers.length,
    renewalsDue: subscribers
      .filter(
        (row) => row.daysLeft !== null && row.daysLeft >= 0 && row.daysLeft <= RENEWAL_WINDOW_DAYS,
      )
      .sort((left, right) => (left.daysLeft ?? 0) - (right.daysLeft ?? 0)),
    lapsed: subscribers.filter((row) => row.daysLeft !== null && row.daysLeft < 0),
    lowBalance: subscribers.filter((row) => row.lowBalance),
    nearCapacity: subscribers.filter(
      (row) =>
        row.includedTransactions !== null && row.transactionsUsed >= row.includedTransactions * 0.8,
    ),
    pendingTopUps: Number(pending[0]?.count ?? 0),
    month: {
      runs: Number(month[0]?.runs ?? 0),
      billedHalalas: billed,
      costHalalas: cost,
      marginPct: billed === 0 ? null : Math.round(((billed - cost) / billed) * 100),
    },
    busiest: busiest.map((row) => ({
      tenantId: row.tenant_id,
      legalName: row.legal_name,
      runs: Number(row.runs),
      billedHalalas: Number(row.billed),
    })),
  };
}
