import type { BundleBalance, Commitment } from '@nx-verify/core';
import type { BalanceView } from '../components/balance-card';

/**
 * Operations while a package or a bundle counts them, riyals otherwise (decision 3 in PLAN.md):
 * the package is spent first, then the bundles, and the wallet pays what goes past both. The
 * operations of a package and of its bundles are one figure, because a run takes from either
 * without asking.
 */
export function balanceOf(
  commitment: Pick<Commitment, 'includedTransactions' | 'transactionsUsed'> | null,
  bundles: Pick<BundleBalance, 'operations' | 'granted'>,
  walletAvailableHalalas: number,
): BalanceView {
  const packageIncluded = commitment?.includedTransactions ?? null;
  if (packageIncluded !== null || bundles.operations > 0) {
    const packageRemaining =
      packageIncluded === null
        ? 0
        : Math.max(0, packageIncluded - (commitment?.transactionsUsed ?? 0));
    return {
      kind: 'operations',
      included: (packageIncluded ?? 0) + bundles.granted,
      remaining: packageRemaining + bundles.operations,
    };
  }
  return { kind: 'wallet', availableHalalas: walletAvailableHalalas };
}
