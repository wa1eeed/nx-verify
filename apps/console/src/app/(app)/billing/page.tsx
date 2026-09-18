import type { ReactElement } from 'react';
import { NoAccess } from '../../../components/no-access';
import {
  bundleBalance,
  getCommitment,
  getWallet,
  listAvailableBundles,
  listEntitlements,
  listProducts,
} from '@nx-verify/core';
import { BundleOffer } from '../../../components/bundle-offer';
import { SpendOrder, spendSteps } from '../../../components/spend-order';
import { Usage, type EntitlementView, type UsageView } from '../../../components/usage';
import { actingUser, query } from '../../../lib/context';
import { FundBanner, LowBanner } from '../../../components/fund-banner';
import { SectionTabs } from '../../../components/section-tabs';
import { BILLING_TABS, visible } from '../../../components/nav';

export const dynamic = 'force-dynamic';

export default async function UsagePage(): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('wallet.read')) {
    return <NoAccess needs="wallet.read" />;
  }
  const bundles = await query(async (tx) => ({
    balance: await bundleBalance(tx),
    onSale: await listAvailableBundles(tx),
  }));

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
      // Both kinds of credit reach the card, because «what can I spend» is one question
      // with two answers and showing one of them reads as having nothing (ADR-160).
      bundleOperations: bundles.balance.operations,
      bundleExpiry: bundles.balance.nextExpiry,
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

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={visible(BILLING_TABS, actor.capabilities)} current="/billing" label="أقسام الاشتراك والرصيد" />
      {/*
        Said where somebody would go looking, rather than left to be discovered as a refusal
        in the middle of a first verification (ADR-154).
      */}
      <FundBanner
        availableHalalas={view.availableHalalas}
        bundleOperations={bundles.balance.operations}
      />
      {/*
        The order a verification is paid in, said once and in the order it happens. Four
        screens each showing one kind of credit taught nobody how they relate (ADR-161).
      */}
      <SpendOrder
        steps={spendSteps({
          includedTransactions: view.includedTransactions,
          transactionsUsed: view.transactionsUsed,
          bundleOperations: view.bundleOperations,
          availableHalalas: view.availableHalalas,
        })}
      />
      {view.isLow ? (
        <LowBanner
          availableHalalas={view.availableHalalas}
          bundleOperations={bundles.balance.operations}
        />
      ) : null}
      <Usage view={view} />
      <BundleOffer
        balance={bundles.balance}
        bundles={bundles.onSale}
          canBuy={actor.can('wallet.topup')}
      />
    </div>
  );
}
