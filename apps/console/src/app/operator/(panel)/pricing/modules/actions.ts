'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NxError, setModuleDefault } from '@nx-verify/core';
import { currentOperator, operatorTransaction } from '../../../../../lib/operator';

/**
 * Changing what a module is worth to a workspace nobody has decided about.
 *
 * The catalogue screen could read `default_on` and nothing could write it, so the answer for
 * every subscriber whose plan is silent came from a seed file. A module is rows (rule 8), and
 * this was the one column of it with no way in.
 *
 * It is written in a transaction with its own trail entry, so the panel's audit screen can
 * never show a change nobody made or miss one somebody did.
 */
export async function setModuleDefaultAction(formData: FormData): Promise<void> {
  const actor = await currentOperator();
  const moduleCode = String(formData.get('module') ?? '').trim();
  const defaultOn = String(formData.get('default_on') ?? '') === 'true';

  try {
    const change = await operatorTransaction((db) =>
      setModuleDefault(db, actor, { moduleCode, defaultOn }),
    );
    revalidatePath('/operator/pricing/modules');
    back(
      change.changed
        ? {
            saved: defaultOn ? 'on' : 'off',
            name: change.nameAr,
            moved: String(change.affected),
          }
        : { saved: 'unchanged', name: change.nameAr },
    );
  } catch (error) {
    if (error instanceof NxError) {
      if (error.code === 'NX-4031') {
        back({ refused: 'role' });
      }
      if (error.code === 'NX-4003') {
        back({ refused: 'core' });
      }
      if (error.code === 'NX-4041') {
        back({ refused: 'unknown' });
      }
    }
    throw error;
  }
}

function back(params: Record<string, string>): never {
  redirect(`/operator/pricing/modules?${new URLSearchParams(params).toString()}`);
}
