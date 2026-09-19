import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { halalasToDecimalString, riyalsToHalalas } from './money.js';
import { vatInForce, vatResolver, withVat, type VatRule } from './vat.js';
import { topUp } from './wallet.js';
import { grantBundleForTopUp } from './bundles.js';

/**
 * Putting money in, and confirming it arrived.
 *
 * A bank transfer rather than a card, because that is how business to business money
 * moves here, and because it needs no gateway account we do not have.
 *
 * The shape is deliberately two sided. The subscriber says what they intend to send and
 * gets a reference to quote in the transfer. We say it arrived, and only then does the
 * balance move. Crediting on the request would mean crediting on an intention, and the
 * first customer to change their mind would spend money that never left their bank.
 */

export interface TopUpRequest {
  id: string;
  reference: string;
  /** In halalas, excluding VAT. */
  amountHalalas: number;
  /** What the transfer should actually be for, VAT included. */
  totalWithVatHalalas: number;
  status: 'REQUESTED' | 'CONFIRMED' | 'REJECTED';
  requestedAt: Date;
  settledAt: Date | null;
  vatInvoiceId: string | null;
  note: string | null;
  /** The bundle this transfer buys, or null for credit in riyals. */
  bundleCode: string | null;
}

const MINIMUM_HALALAS = 100_00;
const MAXIMUM_HALALAS = 10_000_000_00;

/** A reference a person quotes in a bank transfer, per subscriber and per year. */
export async function allocateTopUpReference(
  tx: TenantTransaction,
  at = new Date(),
): Promise<string> {
  const year = at.getUTCFullYear();
  const { rows } = await tx.query<{ next_value: number }>(
    `INSERT INTO topup_counters (tenant_id, year, next_value)
     VALUES ($1, $2, 2)
     ON CONFLICT (tenant_id, year) DO UPDATE SET next_value = topup_counters.next_value + 1
     RETURNING CASE WHEN topup_counters.next_value IS NULL THEN 1
                    ELSE topup_counters.next_value - 1 END AS next_value`,
    [tx.tenantId, year],
  );
  const number = rows[0]?.next_value ?? 1;
  return `TOP-${year}-${String(number).padStart(6, '0')}`;
}

export interface RequestTopUpInput {
  /** In halalas, excluding VAT. */
  amountHalalas: number;
  requestedBy?: string | null;
  note?: string | null;
}

export async function requestTopUp(
  tx: TenantTransaction,
  input: RequestTopUpInput,
): Promise<TopUpRequest> {
  if (
    !Number.isInteger(input.amountHalalas) ||
    input.amountHalalas < MINIMUM_HALALAS ||
    input.amountHalalas > MAXIMUM_HALALAS
  ) {
    throw new NxError('NX-4001', {
      detail: 'a top up is between 100 and 10,000,000 riyals',
    });
  }

  // The rule of today, because today is the date of supply for a request made now.
  const rule = await vatInForce(tx);
  const reference = await allocateTopUpReference(tx);
  const { rows } = await tx.query<{ id: string; requested_at: Date }>(
    `INSERT INTO topup_requests (tenant_id, reference, amount, requested_by, note)
     VALUES ($1, $2, $3::numeric, $4, $5)
     RETURNING id, requested_at`,
    [
      tx.tenantId,
      reference,
      halalasToDecimalString(input.amountHalalas),
      input.requestedBy ?? null,
      input.note ?? null,
    ],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-5001', { detail: 'the request could not be recorded' });
  }

  return {
    id: row.id,
    reference,
    amountHalalas: input.amountHalalas,
    totalWithVatHalalas: withVat(input.amountHalalas, rule).grossHalalas,
    status: 'REQUESTED',
    requestedAt: row.requested_at,
    settledAt: null,
    vatInvoiceId: null,
    note: input.note ?? null,
    bundleCode: null,
  };
}

export async function listTopUpRequests(tx: TenantTransaction): Promise<TopUpRequest[]> {
  const { rows } = await tx.query<{
    id: string;
    reference: string;
    amount: string;
    status: TopUpRequest['status'];
    requested_at: Date;
    settled_at: Date | null;
    vat_invoice_id: string | null;
    note: string | null;
    bundle_code: string | null;
  }>(
    `SELECT id, reference, amount, status, requested_at, settled_at, vat_invoice_id, note,
            bundle_code
     FROM topup_requests WHERE tenant_id = $1 ORDER BY requested_at DESC`,
    [tx.tenantId],
  );
  const rule = await vatResolver(tx);
  return rows.map((row) => toRequest(rule, row));
}

export interface PendingTopUp extends TopUpRequest {
  tenantId: string;
  tenantName: string;
}

/**
 * Every subscriber's unsettled transfers, for the staff who reconcile them.
 *
 * Runs on the operator connection, which crosses subscribers for configuration and for
 * money and for nothing else. A row here says what somebody bought and carries nothing
 * about whom they verified.
 */
export async function listPendingTopUps(operator: Queryable): Promise<PendingTopUp[]> {
  const { rows } = await operator.query<{
    id: string;
    tenant_id: string;
    legal_name: string;
    reference: string;
    amount: string;
    status: TopUpRequest['status'];
    requested_at: Date;
    settled_at: Date | null;
    vat_invoice_id: string | null;
    note: string | null;
    bundle_code: string | null;
  }>(
    `SELECT r.id, r.tenant_id, t.legal_name, r.reference, r.amount, r.status,
            r.requested_at, r.settled_at, r.vat_invoice_id, r.note, r.bundle_code
     FROM topup_requests r
     JOIN tenants t ON t.id = r.tenant_id
     WHERE r.status = 'REQUESTED'
     ORDER BY r.requested_at`,
  );

  const rule = await vatResolver(operator);
  return rows.map((row) => ({
    ...toRequest(rule, row),
    tenantId: row.tenant_id,
    tenantName: row.legal_name,
  }));
}

export interface SettleTopUpInput {
  requestId: string;
  /**
   * The tax invoice, required only while the platform is registered for VAT (ADR-166).
   *
   * It used to be required always, which meant staff confirming a transfer on an
   * unregistered platform had to type a tax invoice number for a transaction that carries no
   * tax and for which no such invoice exists. What people actually did was invent one, so the
   * field recorded a fiction and the check that demanded it protected nothing.
   */
  vatInvoiceId?: string | null;
  settledBy: string;
  note?: string | null;
}

/**
 * Credits the balance, once.
 *
 * The status is flipped by a conditional update and the credit only happens if that
 * update changed a row. Two people pressing confirm at the same moment therefore produce
 * one credit and one refusal, rather than two credits and an afternoon of reconciliation.
 *
 * Runs with the subscriber in scope rather than on the operator connection, because
 * moving a balance is writing a subscriber's own data and the operator role is not
 * allowed to do that.
 */
export async function confirmTopUp(
  tx: TenantTransaction,
  input: SettleTopUpInput,
): Promise<TopUpRequest> {
  const vatInvoiceId = input.vatInvoiceId?.trim() ?? '';
  // Demanded only when there is an invoice to demand. The rule of today, because that is when
  // the confirmation happens and when the tax, if any, falls due.
  const rule = await vatInForce(tx);
  if (rule.registered && vatInvoiceId === '') {
    throw new NxError('NX-4001', {
      detail: 'a confirmed top up needs its tax invoice, because VAT falls due on it',
    });
  }

  const { rows } = await tx.query<{
    id: string;
    reference: string;
    amount: string;
    status: TopUpRequest['status'];
    requested_at: Date;
    settled_at: Date | null;
    vat_invoice_id: string | null;
    note: string | null;
    bundle_code: string | null;
  }>(
    `UPDATE topup_requests
     SET status = 'CONFIRMED', settled_at = now(), settled_by = $3, vat_invoice_id = $4,
         note = coalesce($5, note)
     WHERE tenant_id = $1 AND id = $2 AND status = 'REQUESTED'
     RETURNING id, reference, amount, status, requested_at, settled_at, vat_invoice_id, note,
               bundle_code`,
    [tx.tenantId, input.requestId, input.settledBy, vatInvoiceId === '' ? null : vatInvoiceId, input.note ?? null],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4091', {
      detail: 'that request is not waiting to be confirmed',
    });
  }

  // A transfer that bought a bundle grants its operations; any other credits the wallet.
  if (row.bundle_code !== null) {
    await grantBundleForTopUp(tx, {
      topupRequestId: row.id,
      bundleCode: row.bundle_code,
      grantedBy: input.settledBy,
    });
  } else {
    await topUp(tx, {
      amount: riyalsToHalalas(row.amount),
      vatInvoiceId: vatInvoiceId === '' ? null : vatInvoiceId,
    });
  }
  return toRequest(await vatResolver(tx), row);
}

export async function rejectTopUp(
  tx: TenantTransaction,
  input: { requestId: string; settledBy: string; note?: string | null },
): Promise<void> {
  const { rowCount } = await tx.query(
    `UPDATE topup_requests
     SET status = 'REJECTED', settled_at = now(), settled_by = $3, note = coalesce($4, note)
     WHERE tenant_id = $1 AND id = $2 AND status = 'REQUESTED'`,
    [tx.tenantId, input.requestId, input.settledBy, input.note ?? null],
  );
  if (rowCount === 0) {
    throw new NxError('NX-4091', { detail: 'that request is not waiting to be settled' });
  }
}

function toRequest(
  rule: (when: Date) => VatRule,
  row: {
    id: string;
    reference: string;
    amount: string;
    status: TopUpRequest['status'];
    requested_at: Date;
    settled_at: Date | null;
    vat_invoice_id: string | null;
    note: string | null;
    bundle_code?: string | null;
  },
): TopUpRequest {
  const amountHalalas = riyalsToHalalas(row.amount);
  // Taxed by the rule of its own date, not of today. A request from before the platform was
  // registered stays untaxed however it is read afterwards (ADR-157).
  return {
    id: row.id,
    reference: row.reference,
    amountHalalas,
    totalWithVatHalalas: withVat(amountHalalas, rule(row.requested_at)).grossHalalas,
    status: row.status,
    requestedAt: row.requested_at,
    settledAt: row.settled_at,
    vatInvoiceId: row.vat_invoice_id,
    note: row.note,
    bundleCode: row.bundle_code ?? null,
  };
}
