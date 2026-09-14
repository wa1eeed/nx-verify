import type { ReactElement } from 'react';
import {
  bundleBalance,
  getCommitment,
  getWallet,
  listAvailableBundles,
  listEntitlements,
  listProducts,
} from '@nx-verify/core';
import { BundleOffer } from '../../../components/bundle-offer';
import { requestBundleAction } from './bundle-actions';
import { Usage, type EntitlementView, type UsageView } from '../../../components/usage';
import { query } from '../../../lib/context';
import { SectionTabs } from '../../../components/section-tabs';
import { BILLING_TABS } from '../../../components/nav';

export const dynamic = 'force-dynamic';

export default async function UsagePage(): Promise<ReactElement> {
  const view = await query(async (tx): Promise<UsageView> => {
    const [commitment, wallet, entitlements, products] = await Promise.all([
      getCommitment(tx),
      getWallet(tx),
      listEntitlements(tx),
      listProducts(tx),
    ]);

    const nameOf = new Map(products.map((product) => [product.code, product.nameAr]));

    return {
      packageNameAr: commitment?.packageNameAr ?? null,
      packageCode: commitment?.packageCode ?? null,
      status: commitment?.status ?? null,
      termStart: commitment?.termStart ?? null,
      termEnd: commitment?.termEnd ?? null,
      includedTransactions: commitment?.includedTransactions ?? null,
      transactionsUsed: commitment?.transactionsUsed ?? 0,
      balanceHalalas: wallet.balance,
      heldHalalas: wallet.held,
      availableHalalas: wallet.available,
      isLow: wallet.isLow,
      entitlements: entitlements.map((entry): EntitlementView => ({
        productCode: entry.productCode,
        nameAr: nameOf.get(entry.productCode) ?? entry.productCode,
        allowed: entry.allowed,
        refusal: entry.refusal,
        quota: entry.quota,
        used: entry.used,
        remaining: entry.remaining,
        negotiated: entry.negotiated,
      })),
    };
  });

  const bundles = await query(async (tx) => ({
    balance: await bundleBalance(tx),
    onSale: await listAvailableBundles(tx),
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={BILLING_TABS} current="/billing" label="أقسام الاشتراك والرصيد" />
      <Usage view={view} />
      <BundleOffer
        balance={bundles.balance}
        bundles={bundles.onSale}
        requestAction={requestBundleAction}
      />
    </div>
  );
}
