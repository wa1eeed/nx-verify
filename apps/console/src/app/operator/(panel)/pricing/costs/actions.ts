'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NxError, setProviderCost } from '@nx-verify/core';
import { parsePercent, parseRiyals } from '../../../../../components/admin-pricing/model';
import { currentOperator, operatorTransaction } from '../../../../../lib/operator';

/**
 * Recording what a provider charges us (ADR-166).
 *
 * It does not refuse a rate that puts a price under water. Guard 10 stops us setting a price
 * below a known cost, which is a decision we control; a provider raising theirs is not, and a
 * platform that refuses to write it down carries on quoting a margin that no longer exists.
 * So the cost is recorded and the prices it broke are named on the way back.
 */
export async function saveCostAction(formData: FormData): Promise<void> {
  const actor = await currentOperator();
  const provider = String(formData.get('provider') ?? '').trim();
  const endpoint = String(formData.get('endpoint') ?? '').trim();
  const billedHalalas = parseRiyals(String(formData.get('cost') ?? '').trim());
  const vatPct = parsePercent(String(formData.get('vat_pct') ?? '15').trim());

  if (billedHalalas === null || vatPct === null) {
    back({ refused: 'amount' });
  }

  try {
    const change = await operatorTransaction((db) =>
      setProviderCost(db, actor, {
        provider,
        endpoint,
        billedHalalas,
        vatBps: Math.round(vatPct * 100),
      }),
    );
    revalidatePath('/operator/pricing/costs');
    revalidatePath('/operator/pricing');
    back(
      change.nowUnderCost.length === 0
        ? { saved: 'cost' }
        : { saved: 'cost', broke: change.nowUnderCost.map((row) => row.nameAr).join('، ') },
    );
  } catch (error) {
    if (error instanceof NxError) {
      if (error.code === 'NX-4031') {
        back({ refused: 'role' });
      }
      if (error.code === 'NX-4041') {
        back({ refused: 'unknown' });
      }
      if (error.code === 'NX-4002') {
        back({ refused: 'amount' });
      }
    }
    throw error;
  }
}

function back(params: Record<string, string>): never {
  redirect(`/operator/pricing/costs?${new URLSearchParams(params).toString()}`);
}
