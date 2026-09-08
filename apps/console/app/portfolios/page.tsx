import type { ReactElement } from 'react';
import { listPortfolios, portfolioHealth } from '@nx-verify/core';
import { Portfolios, type PortfolioRowView } from '../../components/portfolios';
import { query } from '../../lib/context';

/**
 * Never prerendered and never cached.
 *
 * This page reads one tenant's live data, and a build machine has no database and no
 * business holding a copy of it. Rendering it at request time is also what keeps a page
 * from showing a snapshot of somebody else's tenant after a deployment.
 */
export const dynamic = 'force-dynamic';

export default async function PortfoliosPage(): Promise<ReactElement> {
  const rows = await query(async (tx) => {
    const portfolios = await listPortfolios(tx);
    const health = await portfolioHealth(tx);
    const byId = new Map(health.map((entry) => [entry.portfolioId, entry]));

    return portfolios.map((portfolio): PortfolioRowView => ({
      portfolioId: portfolio.id,
      code: portfolio.code,
      nameAr: portfolio.nameAr,
      entities: portfolio.memberCount,
      withExpired: byId.get(portfolio.id)?.withExpired ?? 0,
      openCases: byId.get(portfolio.id)?.openCases ?? 0,
      monitorByDefault: portfolio.monitorByDefault,
      monitorBudget: portfolio.monitorBudget,
      decisionRuleset: portfolio.decisionRuleset,
    }));
  });

  return <Portfolios rows={rows} />;
}
