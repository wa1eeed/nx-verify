'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  NxError,
  setCategoryRisk,
  setProductRisk,
  setRiskBands,
  setRiskSignal,
  type RiskCategory,
} from '@nx-verify/core';
import { operatorQuery, requireOperatorPermission } from '../../../../../lib/operator';

/**
 * Editing the risk model.
 *
 * The settings permission, not the pricing one: this decides what a verdict means, which is
 * the same kind of decision as how many sections a file needs, and a different one from what
 * a verification costs.
 */

function back(params: Record<string, string>): never {
  redirect(`/operator/verification/risk?${new URLSearchParams(params).toString()}`);
}

/** A number typed into a field, or undefined when the field was left as it was. */
function numberOf(formData: FormData, name: string): number | undefined {
  const raw = String(formData.get(name) ?? '').trim();
  if (raw === '') {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

export async function setSignalAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('settings');
  const weight = numberOf(formData, 'weight');
  const threshold = numberOf(formData, 'threshold');
  try {
    await operatorQuery((db) =>
      setRiskSignal(
        db,
        {
          code: String(formData.get('code') ?? ''),
          ...(weight === undefined ? {} : { weight }),
          ...(threshold === undefined ? {} : { threshold }),
          enabled: String(formData.get('enabled') ?? 'true') === 'true',
        },
        actor.id,
      ),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    back({ refused: error.code === 'NX-4041' ? 'missing' : 'invalid' });
  }
  revalidatePath('/operator/verification/risk');
  back({ saved: 'signal' });
}

export async function setBandsAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('settings');
  try {
    await operatorQuery((db) =>
      setRiskBands(
        db,
        {
          highFrom: numberOf(formData, 'high_from') ?? Number.NaN,
          mediumFrom: numberOf(formData, 'medium_from') ?? Number.NaN,
        },
        actor.id,
      ),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    back({ refused: 'invalid' });
  }
  revalidatePath('/operator/verification/risk');
  back({ saved: 'bands' });
}

export async function setProductRiskAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('settings');
  try {
    await operatorQuery((db) =>
      setProductRisk(
        db,
        {
          productCode: String(formData.get('product_code') ?? ''),
          enabled: String(formData.get('enabled') ?? '') === 'true',
        },
        actor.id,
      ),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    back({ refused: 'missing' });
  }
  revalidatePath('/operator/verification/risk');
  back({ saved: 'product' });
}

/** Stops or resumes a whole kind of doubt: intersections, mismatches, an unfinished file. */
export async function setCategoryRiskAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('settings');
  try {
    await operatorQuery((db) =>
      setCategoryRisk(
        db,
        {
          category: String(formData.get('category') ?? '') as RiskCategory,
          enabled: String(formData.get('enabled') ?? '') === 'true',
        },
        actor.id,
      ),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    back({ refused: 'missing' });
  }
  revalidatePath('/operator/verification/risk');
  back({ saved: 'category' });
}
