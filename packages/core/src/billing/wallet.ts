import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { halalasToDecimalString, riyalsToHalalas, vatOn } from './money.js';

/**
 * The service balance and its ledger.
 *
 * The ledger is append only. The current balance is the last balance_after, and it is
 * reconciled against wallets.balance. A balance that can be edited is a balance nobody
 * can defend when a customer disputes an invoice.
 *
 * ADR-019: a run reserves its worst case before it starts and settles afterwards. HOLD
 * and RELEASE are ledger reasons beyond the list in the schema document, because the
 * alternative is either holding a row lock across provider calls or letting the balance
 * go negative, and neither is acceptable.
 */

export interface WalletState {
  /** In halalas. */
  balance: number;
  held: number;
  available: number;
  currency: string;
  lowThreshold: number;
  isLow: boolean;
}

export async function getWallet(tx: TenantTransaction): Promise<WalletState> {
  const { rows } = await tx.query<{
    balance: string;
    held: string;
    currency: string;
    low_threshold: string;
  }>(`SELECT balance, held, currency, low_threshold FROM wallets WHERE tenant_id = $1`, [
    tx.tenantId,
  ]);

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', { detail: 'this tenant has no wallet' });
  }

  const balance = riyalsToHalalas(row.balance);
  const held = riyalsToHalalas(row.held);
  const lowThreshold = Number(row.low_threshold);

  return {
    balance,
    held,
    available: balance - held,
    currency: row.currency,
    lowThreshold,
    isLow: balance > 0 && balance - held <= balance * lowThreshold,
  };
}

export async function ensureWallet(tx: TenantTransaction): Promise<void> {
  await tx.query(`INSERT INTO wallets (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [
    tx.tenantId,
  ]);
}

export interface TopUpInput {
  /** In halalas, excluding VAT. */
  amount: number;
  vatInvoiceId: string;
}

/**
 * VAT is due at top up, not at consumption. The TOPUP row carries the invoice id and no
 * CHARGE row ever does, so no second tax invoice can be issued when the balance is spent.
 */
export async function topUp(tx: TenantTransaction, input: TopUpInput): Promise<WalletState> {
  if (input.amount <= 0) {
    throw new NxError('NX-4001', { detail: 'a top up must be positive' });
  }
  await ensureWallet(tx);
  await applyDelta(tx, input.amount, 'TOPUP', null, input.vatInvoiceId);
  return getWallet(tx);
}

/** The VAT that a top up of this size attracts, for the invoice. */
export function vatForTopUp(amountHalalas: number): number {
  return vatOn(amountHalalas);
}

export interface HoldResult {
  held: number;
  available: number;
}

/**
 * Reserves the worst case for a run. Fails before anything is called if the balance
 * cannot cover it, so a customer never discovers the problem halfway through.
 */
export async function hold(tx: TenantTransaction, amount: number): Promise<HoldResult> {
  if (amount < 0) {
    throw new NxError('NX-4001', { detail: 'a hold cannot be negative' });
  }

  const { rows } = await tx.query<{ balance: string; held: string }>(
    `SELECT balance, held FROM wallets WHERE tenant_id = $1 FOR UPDATE`,
    [tx.tenantId],
  );
  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', { detail: 'this tenant has no wallet' });
  }

  const balance = riyalsToHalalas(row.balance);
  const currentlyHeld = riyalsToHalalas(row.held);
  if (balance - currentlyHeld < amount) {
    throw new NxError('NX-4002', { detail: 'insufficient balance for this verification' });
  }

  await tx.query(`UPDATE wallets SET held = held + $2::numeric WHERE tenant_id = $1`, [
    tx.tenantId,
    halalasToDecimalString(amount),
  ]);
  await appendLedger(tx, 0, balance, 'HOLD', null, null);

  return { held: currentlyHeld + amount, available: balance - currentlyHeld - amount };
}

export interface SettleInput {
  runId: string;
  /** What was held for this run. */
  heldAmount: number;
  /** What the run actually earned, in halalas. */
  chargeAmount: number;
}

/**
 * Releases the reservation and charges the real amount, in one transaction.
 *
 * A charge of zero is normal and is recorded as a release with no charge row: an entirely
 * failed run costs the customer nothing, and the ledger should say so plainly rather than
 * carry a zero charge that looks like a mistake.
 */
export async function settle(tx: TenantTransaction, input: SettleInput): Promise<WalletState> {
  const { rows } = await tx.query<{ balance: string; held: string }>(
    `SELECT balance, held FROM wallets WHERE tenant_id = $1 FOR UPDATE`,
    [tx.tenantId],
  );
  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', { detail: 'this tenant has no wallet' });
  }

  const balance = riyalsToHalalas(row.balance);

  await tx.query(`UPDATE wallets SET held = greatest(held - $2::numeric, 0) WHERE tenant_id = $1`, [
    tx.tenantId,
    halalasToDecimalString(input.heldAmount),
  ]);
  await appendLedger(tx, 0, balance, 'RELEASE', input.runId, null);

  if (input.chargeAmount > 0) {
    await applyDelta(tx, -input.chargeAmount, 'CHARGE', input.runId, null);
  }

  return getWallet(tx);
}

/** Releases a hold without charging, for a run that never executed. */
export async function releaseHold(
  tx: TenantTransaction,
  runId: string | null,
  amount: number,
): Promise<void> {
  const { rows } = await tx.query<{ balance: string }>(
    `SELECT balance FROM wallets WHERE tenant_id = $1 FOR UPDATE`,
    [tx.tenantId],
  );
  const balance = riyalsToHalalas(rows[0]?.balance ?? '0');
  await tx.query(`UPDATE wallets SET held = greatest(held - $2::numeric, 0) WHERE tenant_id = $1`, [
    tx.tenantId,
    halalasToDecimalString(amount),
  ]);
  await appendLedger(tx, 0, balance, 'RELEASE', runId, null);
}

export interface LedgerEntry {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  runId: string | null;
  vatInvoiceId: string | null;
  createdAt: Date;
}

export async function getLedger(
  tx: TenantTransaction,
  options: { runId?: string; limit?: number } = {},
): Promise<LedgerEntry[]> {
  const { rows } = await tx.query<{
    id: string;
    delta: string;
    balance_after: string;
    reason: string;
    run_id: string | null;
    vat_invoice_id: string | null;
    created_at: Date;
  }>(
    `SELECT id::text AS id, delta, balance_after, reason, run_id, vat_invoice_id, created_at
     FROM wallet_ledger
     WHERE tenant_id = $1 AND ($2::uuid IS NULL OR run_id = $2)
     ORDER BY id
     LIMIT $3`,
    [tx.tenantId, options.runId ?? null, options.limit ?? 500],
  );

  return rows.map((row) => ({
    id: row.id,
    delta: riyalsToHalalas(row.delta),
    balanceAfter: riyalsToHalalas(row.balance_after),
    reason: row.reason,
    runId: row.run_id,
    vatInvoiceId: row.vat_invoice_id,
    createdAt: row.created_at,
  }));
}

/** Reconciles the ledger against the wallet. Run periodically, and after any incident. */
export async function reconcile(
  tx: TenantTransaction,
): Promise<{ walletBalance: number; ledgerBalance: number; matches: boolean }> {
  const wallet = await getWallet(tx);
  const { rows } = await tx.query<{ total: string | null }>(
    `SELECT COALESCE(sum(delta), 0)::text AS total FROM wallet_ledger WHERE tenant_id = $1`,
    [tx.tenantId],
  );
  const ledgerBalance = riyalsToHalalas(rows[0]?.total ?? '0');
  return {
    walletBalance: wallet.balance,
    ledgerBalance,
    matches: wallet.balance === ledgerBalance,
  };
}

async function applyDelta(
  tx: TenantTransaction,
  delta: number,
  reason: string,
  runId: string | null,
  vatInvoiceId: string | null,
): Promise<void> {
  const { rows } = await tx.query<{ balance: string }>(
    `UPDATE wallets SET balance = balance + $2::numeric
     WHERE tenant_id = $1
     RETURNING balance`,
    [tx.tenantId, halalasToDecimalString(delta)],
  );
  const balanceAfter = riyalsToHalalas(rows[0]?.balance ?? '0');
  await appendLedger(tx, delta, balanceAfter, reason, runId, vatInvoiceId);
}

async function appendLedger(
  tx: TenantTransaction,
  delta: number,
  balanceAfter: number,
  reason: string,
  runId: string | null,
  vatInvoiceId: string | null,
): Promise<void> {
  await tx.query(
    `INSERT INTO wallet_ledger (tenant_id, delta, balance_after, reason, run_id, vat_invoice_id)
     VALUES ($1, $2::numeric, $3::numeric, $4, $5, $6)`,
    [
      tx.tenantId,
      halalasToDecimalString(delta),
      halalasToDecimalString(balanceAfter),
      reason,
      runId,
      vatInvoiceId,
    ],
  );
}
