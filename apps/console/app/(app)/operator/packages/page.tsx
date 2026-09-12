import type { ReactElement } from 'react';
import { listPackagesForOperator, listSubscribers } from '@nx-verify/core';
import { SEED_PRODUCTS } from '@nx-verify/db';
import {
  OperatorPackages,
  type PackageView,
  type SubscriberView,
} from '../../../../components/operator-packages';
import { operatorQuery, requireOperator } from '../../../../lib/operator';
import { assignPackageAction, setOverrideAction, setProductAction } from './actions';

/** Never prerendered, and refuses to render without an operator token. */
export const dynamic = 'force-dynamic';

export default async function OperatorPackagesPage(): Promise<ReactElement> {
  await requireOperator();

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

  return (
    <OperatorPackages
      packages={packages}
      subscribers={subscribers}
      allProducts={data.products}
      setProductAction={setProductAction}
      setOverrideAction={setOverrideAction}
      assignAction={assignPackageAction}
    />
  );
}
