import type { TenantTransaction } from '@nx-verify/db';
import { getWallet, type WalletState } from './wallet.js';
import { computeTermExtras, getCommitment, type Commitment, type TermExtras } from './entitlements.js';

/**
 * What the subscriber owes, has spent, and has left.
 *
 * One deliberate piece of vocabulary runs through this file. The blueprint's tax note is
 * that VAT falls due when credit is bought, not when it is spent: a top up produces a tax
 * invoice, and everything after it is a statement of consumption. So this module produces
 * a statement and never calls itself an invoice, and the screen that shows it says the
 * same. Getting that wrong is not a wording problem, it is a tax problem.
 */

export interface StatementLine {
  month: string;
  productCode: string | null;
  runs: number;
  amountHalalas: number;
}

export interface TopUpLine {
  at: Date;
  amountHalalas: number;
  /** The tax invoice this top up was issued under. */
  vatInvoiceId: string | null;
}

export interface Statement {
  commitment: Commitment | null;
  wallet: WalletState;
  extras: TermExtras | null;
  /** Consumption by month and product. Not an invoice. */
  lines: StatementLine[];
  topUps: TopUpLine[];
  spentThisTermHalalas: number;
}

export async function buildStatement(
  tx: TenantTransaction,
  options: { months?: number } = {},
): Promise<Statement> {
  const months = options.months ?? 6;

  const [commitment, wallet, extras] = await Promise.all([
    getCommitment(tx),
    getWallet(tx),
    computeTermExtras(tx),
  ]);

  // Aggregated from the ledger rather than from the runs, because the ledger is what was
  // actually charged: a run that was refunded, held and released, or billed at zero under
  // the free window has to show what happened rather than what it looked like.
  const { rows } = await tx.query<{
    month: string;
    product_code: string | null;
    runs: string;
    amount: string;
  }>(
    `SELECT to_char(date_trunc('month', l.created_at), 'YYYY-MM') AS month,
            r.product_code,
            count(DISTINCT l.run_id)::text AS runs,
            sum(-l.delta)::text AS amount
     FROM wallet_ledger l
     LEFT JOIN verification_runs r ON r.tenant_id = l.tenant_id AND r.id = l.run_id
     WHERE l.tenant_id = $1 AND l.reason = 'CHARGE'
       AND l.created_at > now() - make_interval(months => $2)
     GROUP BY 1, 2
     ORDER BY 1 DESC, 2`,
    [tx.tenantId, months],
  );

  const topUps = await tx.query<{ created_at: Date; amount: string; vat_invoice_id: string | null }>(
    `SELECT created_at, delta::text AS amount, vat_invoice_id
     FROM wallet_ledger
     WHERE tenant_id = $1 AND reason = 'TOPUP'
     ORDER BY created_at DESC
     LIMIT 24`,
    [tx.tenantId],
  );

  const spent = commitment
    ? await tx.query<{ total: string }>(
        `SELECT coalesce(sum(-delta), 0)::text AS total
         FROM wallet_ledger
         WHERE tenant_id = $1 AND reason = 'CHARGE' AND created_at >= $2`,
        [tx.tenantId, commitment.termStart],
      )
    : null;

  return {
    commitment,
    wallet,
    extras,
    lines: rows.map((row) => ({
      month: row.month,
      productCode: row.product_code,
      runs: Number(row.runs),
      amountHalalas: Number(row.amount),
    })),
    topUps: topUps.rows.map((row) => ({
      at: row.created_at,
      amountHalalas: Number(row.amount),
      vatInvoiceId: row.vat_invoice_id,
    })),
    spentThisTermHalalas: Number(spent?.rows[0]?.total ?? 0),
  };
}
