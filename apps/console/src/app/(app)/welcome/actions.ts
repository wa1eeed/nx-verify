'use server';

import { revalidatePath } from 'next/cache';
import { assertCan, audit, setOwnModule } from '@nx-verify/core';
import { actingUser, query } from '../../../lib/context';

/**
 * A subscriber switching a verification service on for themselves (ADR-154).
 *
 * Safe to allow: a module decides which sections their files draw and which products their
 * calls may use, and all of those spend from a wallet somebody else has to fund. The core
 * module refuses in the domain, with the same sentence the panel gives.
 */
export async function toggleOwnModuleAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'settings.manage');
  const user = await actingUser();
  const moduleCode = String(formData.get('module_code') ?? '');
  const enabled = String(formData.get('enabled') ?? '') === 'true';
  if (moduleCode === '') {
    return;
  }

  await query(async (tx) => {
    await setOwnModule(tx, { moduleCode, enabled, userId: user.userId });
    await audit(tx, {
      actorType: 'USER',
      actorId: user.userId,
      action: 'module.set',
      target: moduleCode,
      metadata: { enabled },
    });
  }).catch(() => undefined);

  revalidatePath('/welcome');
}
