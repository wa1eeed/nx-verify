'use server';

import { revalidatePath } from 'next/cache';
import { setProviderEndpoint } from '@nx-verify/providers';
import { operatorQuery, requireOperator } from '../../../../../lib/operator';

/**
 * Saving one endpoint of one provider in one environment.
 *
 * The field map arrives as `theirs=ours` pairs because that is what a person reads off a
 * provider's documentation, and a JSON textarea in a panel is a way to paste a syntax
 * error into a running system.
 */
function parsePairs(raw: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const part of raw.split(/[,\n]/)) {
    const [left, right] = part.split('=');
    const theirs = left?.trim();
    const ours = right?.trim();
    if (theirs && ours) {
      pairs[theirs] = ours;
    }
  }
  return pairs;
}

export async function setEndpointAction(formData: FormData): Promise<void> {
  await requireOperator();

  const path = String(formData.get('path') ?? '').trim();
  const provider = String(formData.get('provider') ?? '');
  const endpoint = String(formData.get('endpoint') ?? '');
  if (path === '' || provider === '' || endpoint === '') {
    // Nothing entered is not an instruction to clear what is there.
    return;
  }

  const method = String(formData.get('method') ?? 'GET') === 'POST' ? 'POST' : 'GET';
  const dataPath = String(formData.get('data_path') ?? '').trim();
  const bodyMap = parsePairs(String(formData.get('body_map') ?? ''));

  await operatorQuery((db) =>
    setProviderEndpoint(db, {
      provider,
      environment: String(formData.get('environment') ?? 'sandbox') as 'sandbox' | 'live',
      endpoint,
      method,
      path,
      authority: String(formData.get('authority') ?? '').trim() || endpoint,
      dataPath: dataPath === '' ? null : dataPath,
      fieldMap: parsePairs(String(formData.get('field_map') ?? '')),
      // A POST needs a body, and the column refuses the row without one.
      bodyMap: method === 'POST' ? bodyMap : null,
    }),
  );

  revalidatePath('/operator/verification/endpoints');
}
