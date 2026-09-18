import type { ReactElement } from 'react';
import { SectionTabs } from '../../../../../components/section-tabs';
import { PRICING_TABS } from '../../../../../components/operator-shell';
import { planNoticeAr } from '../../../../../components/operator-packages';
import { listPackagesForOperator, listSubscribers } from '@nx-verify/core';
import { SEED_PRODUCTS } from '@nx-verify/db';
import {
  OperatorPackages,
  type PackageView,
  type SubscriberView,
} from '../../../../../components/operator-packages';
import { operatorOrSignIn, operatorQuery } from '../../../../../lib/operator';
import { assignPackageAction, setOverrideAction, setProductAction } from './actions';

/**
 * What each plan sells, and the exceptions written for one subscriber, reached from the plans
 * card of screen 05. Never prerendered, and refuses to render without a sign in.
 */
export const dynamic = 'force-dynamic';

export default async function OperatorPlansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  await operatorOrSignIn();

  const data = await operatorQuery(async (db) => ({
    packages: await listPackagesForOperator(db),
    subscribers: await listSubscribers(db),
    // The catalogue is read from the seed rather than from the products table, because
    // the operator connection has no business reading a subscriber scoped table and the
    // catalogue is the same for everyone.
    products: SEED_PRODUCTS.map((product) => ({ code: product.code, nameAr: product.nameAr })),
  }));

  const nameOf = new Map(data.products.map((product) => [product.code, product.nameAr]));

  const packages: PackageView[] = data.packages.map((plan) => ({
    code: plan.code,
    nameAr: plan.nameAr,
    billingModel: plan.billingModel,
    termMonths: plan.termMonths,
    includedTransactions: plan.includedTransactions,
    platformFeeHalalas: plan.platformFeeHalalas,
    status: plan.status,
    products: plan.products.map((product) => ({
      productCode: product.productCode,
      productNameAr: nameOf.get(product.productCode) ?? product.productCode,
      enabled: product.enabled,
      monthlyQuota: product.monthlyQuota,
      unitPriceHalalas: product.unitPriceHalalas,
    })),
  }));

  const subscribers: SubscriberView[] = data.subscribers.map((row) => ({
    tenantId: row.tenantId,
    legalName: row.legalName,
    slug: row.slug,
    isSandbox: row.isSandbox,
    packageCode: row.packageCode,
    includedTransactions: row.includedTransactions,
    transactionsUsed: row.transactionsUsed,
    overrides: row.overrides.map((override) => ({
      productCode: override.productCode,
      productNameAr: nameOf.get(override.productCode) ?? override.productCode,
      enabled: override.enabled,
    })),
  }));

  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      {/*
        This screen had no notice channel at all: a refused price, a wiped quota and a
        successful save were all indistinguishable from nothing happening (ADR-164).
      */}
      <SectionTabs tabs={PRICING_TABS} current="/operator/pricing/plans" label="أقسام الأسعار" />
      <OperatorPackages
        notice={planNoticeAr({ refused: one('refused'), saved: one('saved') })}
        packages={packages}
        subscribers={subscribers}
        allProducts={data.products}
        setProductAction={setProductAction}
        setOverrideAction={setOverrideAction}
        assignAction={assignPackageAction}
      />
    </div>
  );
}
