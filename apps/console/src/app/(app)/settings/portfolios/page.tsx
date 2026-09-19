import type { ReactElement } from 'react';
import { NoAccess } from '../../../../components/no-access';
import {
  listFreshnessPolicy,
  listPortfolios,
  listProducts,
  listRulesets,
  portfolioHealth,
} from '@nx-verify/core';
import {
  Portfolios,
  type PortfolioRowView,
  type PortfolioTtlView,
} from '../../../../components/portfolios';
import { actingUser, query } from '../../../../lib/context';
import { SectionTabs } from '../../../../components/section-tabs';
import { SETTINGS_TABS, visible } from '../../../../components/nav';
import { createPortfolioAction, setPortfolioTtlAction } from './actions';

/**
 * Never prerendered and never cached.
 *
 * This page reads one tenant's live data, and a build machine has no database and no
 * business holding a copy of it. Rendering it at request time is also what keeps a page
 * from showing a snapshot of somebody else's tenant after a deployment.
 */
export const dynamic = 'force-dynamic';

export default async function PortfoliosPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string }>;
}): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('settings.manage')) {
    return <NoAccess needs="settings.manage" />;
  }
  const { outcome } = await searchParams;
  const data = await query(async (tx) => {
    const portfolios = await listPortfolios(tx);
    const health = await portfolioHealth(tx);
    const byId = new Map(health.map((entry) => [entry.portfolioId, entry]));

    // The form could not offer a product or a ruleset, so a watching group watched nothing
    // and no forked ruleset ever decided anything. Both lists are read here for the selects.
    const [products, rulesets, policy] = await Promise.all([
      listProducts(tx),
      listRulesets(tx),
      listFreshnessPolicy(tx),
    ]);

    // Durations a group already keeps. `listFreshnessPolicy` deliberately hides these from
    // the workspace retention screen, so nothing else in the console could show them.
    const { rows: overrides } = await tx.query<{
      portfolio_id: string;
      field_path: string;
      ttl_days: number;
      weight: number;
    }>(
      `SELECT portfolio_id, field_path, ttl_days, weight
       FROM freshness_policy
       WHERE tenant_id = $1 AND portfolio_id IS NOT NULL
       ORDER BY portfolio_id, field_path`,
      [tx.tenantId],
    );

    const rows = portfolios.map((portfolio): PortfolioRowView => ({
      portfolioId: portfolio.id,
      code: portfolio.code,
      nameAr: portfolio.nameAr,
      entities: portfolio.memberCount,
      withExpired: byId.get(portfolio.id)?.withExpired ?? 0,
      openCases: byId.get(portfolio.id)?.openCases ?? 0,
      monitorByDefault: portfolio.monitorByDefault,
      monitorCadence: portfolio.monitorCadence,
      monitorBudget: portfolio.monitorBudget,
      decisionRuleset: portfolio.decisionRuleset,
      defaultProductCode: portfolio.defaultProductCode,
    }));

    return {
      rows,
      products: products.map((product) => ({ code: product.code, nameAr: product.nameAr })),
      rulesets: rulesets.map((ruleset) => ({ id: ruleset.id, nameAr: ruleset.nameAr })),
      fieldPaths: policy.map((entry) => entry.fieldPath),
      ttls: overrides.map((row): PortfolioTtlView => ({
        portfolioId: row.portfolio_id,
        fieldPath: row.field_path,
        ttlDays: row.ttl_days,
        weight: row.weight,
      })),
    };
  });

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={visible(SETTINGS_TABS, actor.capabilities)} current="/settings/portfolios" label="أقسام الإعدادات" />
      <Portfolios
        rows={data.rows}
        outcome={outcome}
        products={data.products}
        rulesets={data.rulesets}
        fieldPaths={data.fieldPaths}
        ttls={data.ttls}
        createAction={createPortfolioAction}
        setTtlAction={setPortfolioTtlAction}
      />
    </div>
  );
}
