import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { requestTopUp, type TopUpRequest } from './topups.js';

/**
 * Credit bundles, from the subscriber's side (handoff screen 05, PLAN.md decision 3).
 *
 * A bundle is operations bought once and spent over months. A run is paid from the package's
 * operations first, then from a bundle, and only then from the wallet in riyals. Of a
 * subscriber's bundles, the one that lapses first is spent first, so nothing bought expires
 * while a later bundle is being used.
 *
 * An operation is taken when a run is priced and given back when the run turns out to cost
 * nothing, a call that failed or a step that was skipped: a failed operation is never
 * counted (guard 04).
 */

export interface BundleBalance {
  /** Operations left in the bundles that have not lapsed. */
  operations: number;
  /** Operations those bundles were bought with, so what is left can be drawn against it. */
  granted: number;
  /** When the soonest of the bundles still holding operations lapses. */
  nextExpiry: Date | null;
}

export async function bundleBalance(tx: TenantTransaction): Promise<BundleBalance> {
  const { rows } = await tx.query<{
    operations: string | null;
    granted: string | null;
    next_expiry: Date | null;
  }>(
    `SELECT sum(operations - used)::text AS operations, sum(operations)::text AS granted,
            min(expires_at) AS next_expiry
     FROM bundle_grants
     WHERE tenant_id = $1 AND used < operations AND expires_at > now()`,
    [tx.tenantId],
  );
  return {
    operations: Number(rows[0]?.operations ?? 0),
    granted: Number(rows[0]?.granted ?? 0),
    nextExpiry: rows[0]?.next_expiry ?? null,
  };
}

/** Takes one operation from the bundle that lapses first. Null when no bundle has one. */
export async function takeBundleOperation(tx: TenantTransaction): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE bundle_grants SET used = used + 1
     WHERE id = (
       SELECT id FROM bundle_grants
       WHERE tenant_id = $1 AND used < operations AND expires_at > now()
       ORDER BY expires_at, granted_at
       LIMIT 1
       FOR UPDATE
     )
     RETURNING id`,
    [tx.tenantId],
  );
  return rows[0]?.id ?? null;
}

/** Gives an operation back to the bundle it was taken from, for a run that cost nothing. */
export async function returnBundleOperation(tx: TenantTransaction, grantId: string): Promise<void> {
  await tx.query(
    `UPDATE bundle_grants SET used = used - 1 WHERE tenant_id = $1 AND id = $2 AND used > 0`,
    [tx.tenantId, grantId],
  );
}

/** A bundle as it is defined: what it holds, what it costs, and how long it lasts. */
export interface BundleTerms {
  code: string;
  operations: number;
  priceHalalas: number;
  validityMonths: number;
}

export interface AvailableBundle extends BundleTerms {
  /**
   * What one operation costs here, in halalas.
   *
   * This is the figure everything else is read against: two bundles are only comparable by
   * it, and the whole price on the card says nothing without it. It was computed for the
   * panel and never reached the buyer.
   */
  perOperationHalalas: number;
  /**
   * How much cheaper an operation is here than in the smallest bundle on sale, and which
   * bundle that is. Null for the smallest bundle itself and for any that is no cheaper.
   *
   * The percent and its basis are one value on purpose. A bare «−8%» beside a price reads as
   * a discount off what a check ordinarily costs, and it is not that: a bundle operation
   * pays for any check whatever its price, so the only figure it can honestly be measured
   * against is the price of an operation in another bundle. Whoever shows the percent has
   * the basis in hand and cannot show one without the other.
   */
  discount: { pct: number; againstOperations: number } | null;
}

/**
 * The price of one operation in each bundle, and the discount that price earns.
 *
 * The basis is the smallest bundle on sale, found by its number of operations rather than
 * taken from the head of the list: a caller's order is not a promise, and the card that
 * measured against `bundles[0]` would have printed a discount against whatever happened to
 * be first the day the query's ORDER BY changed.
 */
export function pricePerOperation(bundles: readonly BundleTerms[]): AvailableBundle[] {
  let basis: BundleTerms | null = null;
  for (const bundle of bundles) {
    if (basis === null || bundle.operations < basis.operations) {
      basis = bundle;
    }
  }
  const basisUnit = basis === null ? 0 : Math.round(basis.priceHalalas / basis.operations);
  return bundles.map((bundle) => {
    // The percent is measured on the two prices the card prints, not on the unrounded ones
    // behind them. Measured before rounding, a bundle a third of a halala cheaper an
    // operation earns «أقل 1%» beside a price identical to the one it is measured against,
    // and the buyer is asked to believe a subtraction the screen contradicts.
    const unit = Math.round(bundle.priceHalalas / bundle.operations);
    const pct = basisUnit === 0 ? 0 : Math.round((1 - unit / basisUnit) * 100);
    return {
      ...bundle,
      perOperationHalalas: unit,
      discount: basis === null || pct <= 0 ? null : { pct, againstOperations: basis.operations },
    };
  });
}

export async function listAvailableBundles(tx: TenantTransaction): Promise<AvailableBundle[]> {
  const { rows } = await tx.query<{
    code: string;
    operations: number;
    price_halalas: string;
    validity_months: number;
  }>(
    `SELECT code, operations, price_halalas::text, validity_months FROM credit_bundles
     WHERE status = 'active' ORDER BY operations`,
  );
  return pricePerOperation(
    rows.map((row) => ({
      code: row.code,
      operations: row.operations,
      priceHalalas: Number(row.price_halalas),
      validityMonths: row.validity_months,
    })),
  );
}

/**
 * Asking to buy a bundle: a transfer request for its price, which grants the bundle when
 * staff confirm the transfer arrived, as a wallet top up credits the wallet.
 */
export async function requestBundle(
  tx: TenantTransaction,
  input: { bundleCode: string; requestedBy?: string | null },
): Promise<TopUpRequest> {
  const bundle = (await listAvailableBundles(tx)).find((entry) => entry.code === input.bundleCode);
  if (!bundle) {
    throw new NxError('NX-4041', { detail: 'no such bundle on sale' });
  }
  const request = await requestTopUp(tx, {
    amountHalalas: bundle.priceHalalas,
    requestedBy: input.requestedBy ?? null,
  });
  await tx.query(`UPDATE topup_requests SET bundle_code = $3 WHERE tenant_id = $1 AND id = $2`, [
    tx.tenantId,
    request.id,
    bundle.code,
  ]);
  return { ...request, bundleCode: bundle.code };
}

/** Grants the bundle a confirmed transfer bought. Once per transfer, however often it is confirmed. */
export async function grantBundleForTopUp(
  tx: TenantTransaction,
  input: { topupRequestId: string; bundleCode: string; grantedBy: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO bundle_grants (tenant_id, bundle_code, operations, price_halalas, expires_at,
                                topup_request_id, granted_by)
     SELECT $1, b.code, b.operations, b.price_halalas,
            now() + make_interval(months => b.validity_months), $2, $4
     FROM credit_bundles b WHERE b.code = $3
     ON CONFLICT DO NOTHING`,
    [tx.tenantId, input.topupRequestId, input.bundleCode, input.grantedBy],
  );
}
