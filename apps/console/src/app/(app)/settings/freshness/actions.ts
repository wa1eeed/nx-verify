'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertCan, audit, clearTenantTtl, setTenantTtl } from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';

/**
 * Changing how long a fact stays current (ADR-146).
 *
 * The preview has always worked and nothing could apply it: a subscriber could ask «what
 * happens if I make the commercial registry good for sixty days» and then had no way to say
 * yes. A screen that answers a question and refuses to act on the answer is worse than one
 * that never asked.
 *
 * Nothing here rewrites a fact, which is what the screen says out loud and rule 1 requires.
 * A duration is an input to a calculation; changing it recomputes freshness and touches no
 * attestation, and guard 07 proves that on every run.
 */

const HERE = '/settings/freshness';

function back(outcome: string, extra = ''): never {
  redirect(`${HERE}?outcome=${outcome}${extra}`);
}

/**
 * Asks what a duration would do, or does it.
 *
 * One action for both, because the two buttons live in one form: which was pressed arrives
 * as `intent`. Preview writes nothing at all, which is the whole reason it exists before the
 * save rather than after it.
 */
export async function setTtlAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'settings.manage');
  const user = await actingUser();
  const fieldPath = String(formData.get('field_path') ?? '');
  const ttlDays = Number(formData.get('ttl_days') ?? NaN);
  const weight = Number(formData.get('weight') ?? NaN);

  if (String(formData.get('intent') ?? '') === 'preview') {
    if (fieldPath === '' || !Number.isFinite(ttlDays) || ttlDays <= 0) {
      back('invalid');
    }
    redirect(`${HERE}?field=${encodeURIComponent(fieldPath)}&ttl=${String(ttlDays)}`);
  }

  if (fieldPath === '' || !Number.isFinite(ttlDays) || ttlDays <= 0 || ttlDays > 3650) {
    back('invalid');
  }
  // The weight moves with the duration, because a duration with no weight has no meaning in
  // the confidence score. A blank box keeps what the row already carried.
  if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
    back('invalid');
  }

  try {
    await query(async (tx) => {
      await setTenantTtl(tx, { fieldPath, ttlDays, weight });
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'freshness.set',
        target: fieldPath,
        metadata: { ttl_days: ttlDays, weight },
      });
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back('failed');
  }

  revalidatePath(HERE);
  back('saved');
}

export async function clearTtlAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'settings.manage');
  const user = await actingUser();
  const fieldPath = String(formData.get('field_path') ?? '');
  if (fieldPath === '') {
    back('failed');
  }

  await query(async (tx) => {
    await clearTenantTtl(tx, fieldPath);
    await audit(tx, {
      actorType: 'USER',
      actorId: user.userId,
      action: 'freshness.cleared',
      target: fieldPath,
      metadata: {},
    });
  });

  revalidatePath(HERE);
  back('cleared');
}

/** A redirect inside a try is a thrown value, not a failure: it has to travel. */
function isRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
