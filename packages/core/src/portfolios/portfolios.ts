import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { audit } from '../auth/audit.js';
import { createMonitor, type Cadence } from '../monitoring/monitors.js';
import { halalasToDecimalString, riyalsToHalalas } from '../billing/money.js';

/**
 * Portfolios.
 *
 * A portfolio is a grouping with a purpose, and the purpose is expressed as policy: which
 * product, which decision rules, which retention, and whether members are monitored. That
 * is why it is the most important organising layer in the product. A platform with one
 * global setting makes a customer choose the stricter policy and pay for it everywhere.
 *
 * Adding an entity to a portfolio that monitors its members creates the monitor then and
 * there, recording who added it. Monitoring is never silent: the act of adding is the
 * consent, and it has a name attached to it.
 */

export interface PortfolioPolicy {
  defaultProductCode?: string | null;
  decisionRuleset?: string | null;
  monitorByDefault?: boolean;
  monitorCadence?: Cadence | null;
  /** In halalas. */
  monitorBudget?: number | null;
  alertOnEnter?: boolean;
}

export interface CreatePortfolioInput extends PortfolioPolicy {
  code: string;
  nameAr: string;
  nameEn: string;
}

export interface Portfolio {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  defaultProductCode: string | null;
  decisionRuleset: string | null;
  monitorByDefault: boolean;
  monitorCadence: Cadence | null;
  monitorBudget: number | null;
  alertOnEnter: boolean;
  memberCount: number;
}

export async function createPortfolio(
  tx: TenantTransaction,
  input: CreatePortfolioInput,
): Promise<string> {
  if (input.monitorByDefault && (!input.monitorCadence || !input.monitorBudget)) {
    // The database refuses this too. Saying it here gives a usable message instead of a
    // constraint name.
    throw new NxError('NX-4001', {
      detail: 'a portfolio that monitors its members needs a cadence and a budget',
    });
  }

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO portfolios (tenant_id, code, name_ar, name_en, default_product_code,
                             decision_ruleset, monitor_by_default, monitor_cadence,
                             monitor_budget_sar, alert_on_enter)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10)
     RETURNING id`,
    [
      tx.tenantId,
      input.code,
      input.nameAr,
      input.nameEn,
      input.defaultProductCode ?? null,
      input.decisionRuleset ?? null,
      input.monitorByDefault ?? false,
      input.monitorCadence ?? null,
      input.monitorBudget === null || input.monitorBudget === undefined
        ? null
        : halalasToDecimalString(input.monitorBudget),
      input.alertOnEnter ?? false,
    ],
  );

  const id = rows[0]?.id;
  if (!id) {
    throw new NxError('NX-5001', { detail: 'portfolio insert returned no id' });
  }
  return id;
}

export async function listPortfolios(tx: TenantTransaction): Promise<Portfolio[]> {
  const { rows } = await tx.query<{
    id: string;
    code: string;
    name_ar: string;
    name_en: string;
    default_product_code: string | null;
    decision_ruleset: string | null;
    monitor_by_default: boolean;
    monitor_cadence: Cadence | null;
    monitor_budget_sar: string | null;
    alert_on_enter: boolean;
    member_count: string;
  }>(
    `SELECT p.id, p.code, p.name_ar, p.name_en, p.default_product_code, p.decision_ruleset,
            p.monitor_by_default, p.monitor_cadence, p.monitor_budget_sar, p.alert_on_enter,
            count(m.entity_id)::text AS member_count
     FROM portfolios p
     LEFT JOIN portfolio_members m ON m.tenant_id = p.tenant_id AND m.portfolio_id = p.id
     WHERE p.tenant_id = $1
     GROUP BY p.id
     ORDER BY p.code`,
    [tx.tenantId],
  );

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    defaultProductCode: row.default_product_code,
    decisionRuleset: row.decision_ruleset,
    monitorByDefault: row.monitor_by_default,
    monitorCadence: row.monitor_cadence,
    monitorBudget: row.monitor_budget_sar === null ? null : riyalsToHalalas(row.monitor_budget_sar),
    alertOnEnter: row.alert_on_enter,
    memberCount: Number(row.member_count),
  }));
}

export interface AddMemberResult {
  added: boolean;
  monitorId: string | null;
}

export async function addToPortfolio(
  tx: TenantTransaction,
  portfolioId: string,
  entityId: string,
  addedBy: string,
): Promise<AddMemberResult> {
  const { rowCount } = await tx.query(
    `INSERT INTO portfolio_members (tenant_id, portfolio_id, entity_id, added_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [tx.tenantId, portfolioId, entityId, addedBy],
  );

  if (rowCount === 0) {
    return { added: false, monitorId: null };
  }

  await audit(tx, {
    actorType: 'USER',
    actorId: addedBy,
    action: 'portfolio.member_added',
    target: `${portfolioId}:${entityId}`,
  });

  const { rows } = await tx.query<{
    monitor_by_default: boolean;
    monitor_cadence: Cadence | null;
    monitor_budget_sar: string | null;
    default_product_code: string | null;
  }>(
    `SELECT monitor_by_default, monitor_cadence, monitor_budget_sar, default_product_code
     FROM portfolios WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, portfolioId],
  );

  const portfolio = rows[0];
  if (
    !portfolio?.monitor_by_default ||
    !portfolio.monitor_cadence ||
    !portfolio.monitor_budget_sar ||
    !portfolio.default_product_code
  ) {
    return { added: true, monitorId: null };
  }

  // Monitoring still records a person and a budget. The portfolio decided the policy;
  // adding this entity to it is the act, and it is not anonymous.
  const monitorId = await createMonitor(tx, {
    entityId,
    productCode: portfolio.default_product_code,
    fieldPaths: ['cr.status'],
    cadence: portfolio.monitor_cadence,
    budgetCapPerPeriod: riyalsToHalalas(portfolio.monitor_budget_sar),
    activatedBy: addedBy,
    consentRef: `portfolio:${portfolioId}`,
  });

  return { added: true, monitorId };
}

export async function removeFromPortfolio(
  tx: TenantTransaction,
  portfolioId: string,
  entityId: string,
  removedBy: string,
): Promise<void> {
  await tx.query(
    `DELETE FROM portfolio_members
     WHERE tenant_id = $1 AND portfolio_id = $2 AND entity_id = $3`,
    [tx.tenantId, portfolioId, entityId],
  );

  await audit(tx, {
    actorType: 'USER',
    actorId: removedBy,
    action: 'portfolio.member_removed',
    target: `${portfolioId}:${entityId}`,
  });
}

/**
 * The decision rules that apply to an entity.
 *
 * A portfolio's rules beat the product's, because the portfolio is where the purpose
 * lives: the same complete business check means one thing for onboarding a merchant and
 * another for paying out to a beneficiary.
 */
export async function resolveRuleset(
  tx: TenantTransaction,
  entityId: string,
  productRuleset: string | null,
): Promise<string | null> {
  const { rows } = await tx.query<{ decision_ruleset: string }>(
    `SELECT p.decision_ruleset
     FROM portfolio_members m
     JOIN portfolios p ON p.tenant_id = m.tenant_id AND p.id = m.portfolio_id
     WHERE m.tenant_id = $1 AND m.entity_id = $2 AND p.decision_ruleset IS NOT NULL
     ORDER BY p.created_at
     LIMIT 1`,
    [tx.tenantId, entityId],
  );

  return rows[0]?.decision_ruleset ?? productRuleset;
}

/** Sets a retention override for one portfolio, the third and most specific level. */
export async function setPortfolioTtl(
  tx: TenantTransaction,
  portfolioId: string,
  fieldPath: string,
  ttlDays: number,
  weight: number,
): Promise<void> {
  if (ttlDays <= 0) {
    throw new NxError('NX-4001', { detail: 'ttl_days must be greater than zero' });
  }

  await tx.query(
    `INSERT INTO freshness_policy (tenant_id, portfolio_id, field_path, ttl_days, weight)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ((COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
                  (COALESCE(portfolio_id, '00000000-0000-0000-0000-000000000000'::uuid)),
                  field_path)
     DO UPDATE SET ttl_days = EXCLUDED.ttl_days, weight = EXCLUDED.weight, updated_at = now()`,
    [tx.tenantId, portfolioId, fieldPath, ttlDays, weight],
  );
}

export interface PortfolioMembership {
  portfolioId: string;
  code: string;
  nameAr: string;
}

export async function membershipsOf(
  tx: TenantTransaction,
  entityId: string,
): Promise<PortfolioMembership[]> {
  const { rows } = await tx.query<{ id: string; code: string; name_ar: string }>(
    `SELECT p.id, p.code, p.name_ar
     FROM portfolio_members m
     JOIN portfolios p ON p.tenant_id = m.tenant_id AND p.id = m.portfolio_id
     WHERE m.tenant_id = $1 AND m.entity_id = $2
     ORDER BY p.code`,
    [tx.tenantId, entityId],
  );

  return rows.map((row) => ({ portfolioId: row.id, code: row.code, nameAr: row.name_ar }));
}
