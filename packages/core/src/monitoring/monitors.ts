import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { halalasToDecimalString, riyalsToHalalas } from '../billing/money.js';

/**
 * Scheduled re-verification.
 *
 * Nothing is monitored by default. docs/01-blueprint.md section 5.6 is explicit that
 * automatic re-verification spending a customer's balance without an explicit request is
 * a trust failure, so a monitor records who switched it on and under what consent, and it
 * cannot exist without a budget.
 *
 * The budget is enforced before each run rather than after. A cap that is checked
 * afterwards is not a cap.
 */

export type Cadence = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ON_EXPIRY';

export interface CreateMonitorInput {
  entityId: string;
  productCode: string;
  fieldPaths: string[];
  cadence: Cadence;
  /** In halalas. */
  budgetCapPerPeriod: number;
  activatedBy: string;
  consentRef?: string | null;
  firstRunAt?: Date;
}

export async function createMonitor(
  tx: TenantTransaction,
  input: CreateMonitorInput,
): Promise<string> {
  if (input.budgetCapPerPeriod <= 0) {
    throw new NxError('NX-4001', { detail: 'a monitor needs a budget cap above zero' });
  }
  if (input.fieldPaths.length === 0) {
    throw new NxError('NX-4001', { detail: 'a monitor needs at least one field' });
  }

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO monitors
       (tenant_id, entity_id, product_code, field_paths, cadence, next_run_at,
        budget_cap_sar, activated_by, consent_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9)
     RETURNING id`,
    [
      tx.tenantId,
      input.entityId,
      input.productCode,
      input.fieldPaths,
      input.cadence,
      input.firstRunAt ?? nextRunFor(input.cadence, new Date()),
      halalasToDecimalString(input.budgetCapPerPeriod),
      input.activatedBy,
      input.consentRef ?? null,
    ],
  );

  const id = rows[0]?.id;
  if (!id) {
    throw new NxError('NX-5001', { detail: 'monitor insert returned no id' });
  }
  return id;
}

export interface DueMonitor {
  monitorId: string;
  entityId: string;
  productCode: string;
  fieldPaths: string[];
  cadence: Cadence;
  budgetCap: number;
  spentThisPeriod: number;
  remainingBudget: number;
}

export async function claimDueMonitors(
  tx: TenantTransaction,
  limit = 25,
  now = new Date(),
): Promise<DueMonitor[]> {
  const { rows } = await tx.query<{
    id: string;
    entity_id: string;
    product_code: string;
    field_paths: string[];
    cadence: Cadence;
    budget_cap_sar: string;
    spent_this_period: string;
  }>(
    `SELECT id, entity_id, product_code, field_paths, cadence, budget_cap_sar, spent_this_period
     FROM monitors
     WHERE tenant_id = $1 AND status = 'active' AND next_run_at <= $2
     ORDER BY next_run_at
     LIMIT $3
     FOR UPDATE SKIP LOCKED`,
    [tx.tenantId, now, limit],
  );

  return rows.map((row) => {
    const cap = riyalsToHalalas(row.budget_cap_sar);
    const spent = riyalsToHalalas(row.spent_this_period);
    return {
      monitorId: row.id,
      entityId: row.entity_id,
      productCode: row.product_code,
      fieldPaths: row.field_paths,
      cadence: row.cadence,
      budgetCap: cap,
      spentThisPeriod: spent,
      remainingBudget: cap - spent,
    };
  });
}

/**
 * Rolls the period over if the month changed, then reports what is left.
 *
 * Checked before the run, never after. A monitor that discovers it is over budget once
 * the money is spent has not enforced anything.
 */
export async function budgetRemaining(
  tx: TenantTransaction,
  monitorId: string,
  now = new Date(),
): Promise<number> {
  await tx.query(
    `UPDATE monitors
     SET spent_this_period = 0, period_started_at = date_trunc('month', $3::timestamptz)
     WHERE tenant_id = $1 AND id = $2
       AND period_started_at < date_trunc('month', $3::timestamptz)`,
    [tx.tenantId, monitorId, now],
  );

  const { rows } = await tx.query<{ budget_cap_sar: string; spent_this_period: string }>(
    `SELECT budget_cap_sar, spent_this_period FROM monitors WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, monitorId],
  );

  const row = rows[0];
  if (!row) {
    return 0;
  }
  return riyalsToHalalas(row.budget_cap_sar) - riyalsToHalalas(row.spent_this_period);
}

export async function recordMonitorSpend(
  tx: TenantTransaction,
  monitorId: string,
  amount: number,
  now = new Date(),
): Promise<void> {
  await tx.query(
    `UPDATE monitors
     SET spent_this_period = spent_this_period + $3::numeric,
         status = CASE
           WHEN spent_this_period + $3::numeric >= budget_cap_sar THEN 'budget_exhausted'
           ELSE status
         END
     WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, monitorId, halalasToDecimalString(amount)],
  );
  void now;
}

export async function scheduleNextRun(
  tx: TenantTransaction,
  monitorId: string,
  cadence: Cadence,
  from = new Date(),
): Promise<void> {
  await tx.query(`UPDATE monitors SET next_run_at = $3 WHERE tenant_id = $1 AND id = $2`, [
    tx.tenantId,
    monitorId,
    nextRunFor(cadence, from),
  ]);
}

export function nextRunFor(cadence: Cadence, from: Date): Date {
  const next = new Date(from.getTime());
  switch (cadence) {
    case 'DAILY':
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    case 'WEEKLY':
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case 'MONTHLY':
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
    case 'ON_EXPIRY':
      // Re-examined daily, and the expiry itself decides whether anything is called.
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
  }
}

export async function pauseMonitor(tx: TenantTransaction, monitorId: string): Promise<void> {
  await tx.query(`UPDATE monitors SET status = 'paused' WHERE tenant_id = $1 AND id = $2`, [
    tx.tenantId,
    monitorId,
  ]);
}

/**
 * Fields that have aged out, computed with no call and no cost.
 *
 * This is the free layer that creates demand for the paid one. The alert says a field
 * expired; next to it sit "verify now" and "start monitoring", and the customer decides.
 */
export interface ExpiryAlert {
  entityId: string;
  fieldPath: string;
  effectiveUntil: Date | null;
  freshness: string;
}

export async function findExpiringFields(
  tx: TenantTransaction,
  limit = 200,
): Promise<ExpiryAlert[]> {
  const { rows } = await tx.query<{
    entity_id: string;
    field_path: string;
    effective_until: Date | null;
    freshness: string;
  }>(
    `SELECT entity_id, field_path, effective_until, freshness
     FROM entity_profile
     WHERE tenant_id = $1 AND freshness IN ('expired', 'expiring')
     ORDER BY effective_until NULLS LAST
     LIMIT $2`,
    [tx.tenantId, limit],
  );

  return rows.map((row) => ({
    entityId: row.entity_id,
    fieldPath: row.field_path,
    effectiveUntil: row.effective_until,
    freshness: row.freshness,
  }));
}
