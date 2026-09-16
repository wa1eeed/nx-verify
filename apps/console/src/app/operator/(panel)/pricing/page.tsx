import type { ReactElement } from 'react';
import {
  MINIMUM_MARGIN_PCT,
  getPlatformSettings,
  listCreditBundles,
  listOperatorAudit,
  listPlans,
  listProductPricing,
  listSettableSections,
  listSpecialPrices,
  listSubscribers,
  operatorCan,
} from '@nx-verify/core';
import { AdminPricing } from '../../../../components/admin-pricing';
import { SectionTabs } from '../../../../components/section-tabs';
import { PRICING_TABS } from '../../../../components/operator-shell';
import { noticeAr } from '../../../../components/admin-pricing/model';
import { operatorOrSignIn, operatorQuery } from '../../../../lib/operator';
import { operatorNameOf } from '../../../../lib/operator-names';
import {
  addBundleAction,
  addPlanAction,
  retireBundleAction,
  savePricingAction,
  setSpecialPriceAction,
} from './actions';

/** Never prerendered, and refuses to render without a sign in. */
export const dynamic = 'force-dynamic';

/**
 * The prices and products of the platform (handoff screen 05).
 *
 * Everything is read on the operator connection: the catalogue and its costs, the monthly
 * counters every subscriber's use is summed into, and the commercial rows staff set. Nothing a
 * subscriber verified reaches this screen.
 */
export default async function OperatorPricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const operator = await operatorOrSignIn();
  const params = Object.fromEntries(
    Object.entries(await searchParams).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );

  const data = await operatorQuery(async (db) => ({
    products: await listProductPricing(db),
    bundles: await listCreditBundles(db),
    plans: await listPlans(db),
    specialPrices: await listSpecialPrices(db),
    settings: await getPlatformSettings(db),
    sections: await listSettableSections(db),
    subscribers: await listSubscribers(db),
    lastChange: (
      await listOperatorAudit(db, { targetPrefixes: ['pricing:', 'settings:'], limit: 1 })
    )[0],
  }));

  const nameOf = new Map(data.products.map((product) => [product.productCode, product.nameAr]));

  return (
    <div className="stack">
      <SectionTabs tabs={PRICING_TABS} current="/operator/pricing" label="أقسام الأسعار" />
      <AdminPricing
        view={{
          canEditPricing: operatorCan(operator.role, 'pricing'),
          canEditSettings: operatorCan(operator.role, 'settings'),
          lastChange:
            data.lastChange === undefined
              ? null
              : { byName: operatorNameOf(data.lastChange), at: data.lastChange.at },
          notice: noticeAr(params, (code) => nameOf.get(code) ?? code),
          products: data.products,
          bundles: data.bundles,
          plans: data.plans,
          specialPrices: data.specialPrices,
          settings: data.settings,
          sections: data.sections,
          subscribers: data.subscribers
            .filter((subscriber) => !subscriber.isSandbox)
            .map((subscriber) => ({
              tenantId: subscriber.tenantId,
              legalName: subscriber.legalName,
            })),
          minimumMarginPct: MINIMUM_MARGIN_PCT,
        }}
        actions={{
          save: savePricingAction,
          addBundle: addBundleAction,
          retireBundle: retireBundleAction,
          addPlan: addPlanAction,
          setSpecialPrice: setSpecialPriceAction,
        }}
      />
    </div>
  );
}
