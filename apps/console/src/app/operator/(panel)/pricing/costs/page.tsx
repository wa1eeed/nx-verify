import type { ReactElement } from 'react';
import {
  costVatRule,
  listProviderCosts,
  listUnpricedCalls,
  operatorCan,
} from '@nx-verify/core';
import { OperatorCosts, type CostsView } from '../../../../../components/operator-costs';
import { SectionTabs } from '../../../../../components/section-tabs';
import { PRICING_TABS } from '../../../../../components/operator-shell';
import { operatorOrSignIn, operatorQuery } from '../../../../../lib/operator';
import { costNoticeAr, saveCostAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * What each provider call costs us (ADR-166).
 *
 * The screen the panel was missing. Every margin it shows is arithmetic on this table, and it
 * could only be read: the rates came from a seed file, so the margin was right for exactly as
 * long as that file matched the contract, and an owner who signed a new rate had nowhere to
 * put it.
 */
export default async function OperatorCostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const operator = await operatorOrSignIn();
  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };

  const data = await operatorQuery(async (db) => ({
    costs: await listProviderCosts(db),
    unpriced: await listUnpricedCalls(db),
    vat: await costVatRule(db),
  }));

  const view: CostsView = {
    costs: data.costs.map((cost) => ({
      provider: cost.provider,
      providerNameAr: cost.providerNameAr,
      endpoint: cost.endpoint,
      billedHalalas: cost.billedHalalas,
      vatBps: cost.vatBps,
      effectiveHalalas: cost.effectiveHalalas,
      usedByProducts: cost.usedByProducts,
    })),
    unpriced: data.unpriced,
    vatRegistered: data.vat.registered,
    canEdit: operatorCan(operator.role, 'pricing'),
    notice: costNoticeAr({
      refused: one('refused'),
      saved: one('saved'),
      broke: one('broke'),
    }),
  };

  return (
    <div className="stack">
      <SectionTabs tabs={PRICING_TABS} current="/operator/pricing/costs" label="أقسام الأسعار" />
      <OperatorCosts view={view} saveAction={saveCostAction} />
    </div>
  );
}
