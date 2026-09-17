'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { activateKeyVersion, retireKeyVersion } from '@nx-verify/core';
import { operatorQuery, requireOperatorPermission } from '../../../../../lib/operator';

/**
 * Declaring which key version is written with, and discarding one (ADR-152).
 *
 * The rotation job has always re-encrypted rows onto «the current key», and nothing could
 * declare a new current key or retire an old one: rotation was a mover with no control.
 *
 * Retiring is refused on anything but a retiring version, in the domain. That refusal is not
 * a formality: a version retired while a row still reads it makes that row unreadable, and a
 * sealed evidence document whose signing version is retired out from under it becomes
 * uncheckable. Neither is recoverable.
 */

const HERE = '/operator/verification/keys';

function back(outcome: string): never {
  redirect(`${HERE}?outcome=${outcome}`);
}

export async function activateVersionAction(formData: FormData): Promise<void> {
  await requireOperatorPermission('integration');
  const version = Number(formData.get('version') ?? NaN);
  const notes = String(formData.get('notes') ?? '').trim();

  if (!Number.isInteger(version) || version <= 0) {
    back('invalid');
  }

  try {
    await operatorQuery((db) => activateKeyVersion(db, version, notes === '' ? undefined : notes));
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back('failed');
  }

  revalidatePath(HERE);
  back('activated');
}

export async function retireVersionAction(formData: FormData): Promise<void> {
  await requireOperatorPermission('integration');
  const version = Number(formData.get('version') ?? NaN);
  if (!Number.isInteger(version) || version <= 0) {
    back('invalid');
  }

  try {
    await operatorQuery((db) => retireKeyVersion(db, version));
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back((error as { code?: string }).code === 'NX-4002' ? 'not-retiring' : 'failed');
  }

  revalidatePath(HERE);
  back('retired');
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
