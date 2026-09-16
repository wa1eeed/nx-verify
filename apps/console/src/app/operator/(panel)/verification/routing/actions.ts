'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NxError, removeServiceRoute, setServiceRoute } from '@nx-verify/core';
import { operatorQuery, requireOperatorPermission } from '../../../../../lib/operator';

/**
 * Putting a provider on a verification service, and taking one off.
 *
 * The pricing permission, not the subscribers one: this decides what a service costs us and
 * therefore what the margin on it is, which is the same decision as setting its price.
 */

function back(params: Record<string, string>): never {
  redirect(`/operator/verification/routing?${new URLSearchParams(params).toString()}`);
}

export async function setRouteAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('pricing');
  const priority = Number(formData.get('priority') ?? 1);
  const status = String(formData.get('status') ?? 'active');
  try {
    await operatorQuery((db) =>
      setServiceRoute(db, {
        productCode: String(formData.get('product_code') ?? ''),
        provider: String(formData.get('provider') ?? ''),
        priority: Number.isFinite(priority) ? priority : 1,
        status: status === 'standby' ? 'standby' : 'active',
        actorId: actor.id,
      }),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    back({ refused: 'invalid' });
  }
  revalidatePath('/operator/verification/routing');
  back({ saved: 'routed' });
}

export async function removeRouteAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('pricing');
  try {
    await operatorQuery((db) =>
      removeServiceRoute(db, {
        productCode: String(formData.get('product_code') ?? ''),
        provider: String(formData.get('provider') ?? ''),
        actorId: actor.id,
      }),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    back({ refused: 'missing' });
  }
  revalidatePath('/operator/verification/routing');
  back({ saved: 'removed' });
}
