import type { CheckOutcome } from '@nx-verify/core';

/**
 * What the last verification did, for the page that follows it.
 *
 * Kept for two minutes in a cookie scoped to the customer screens: long enough to render
 * the result once after the redirect, and never in an address that gets copied or logged.
 */

export const RESULT_COOKIE = 'nx_checks_result';

export interface StoredResult {
  bundle: string;
  outcomes: { productCode: string; status: CheckOutcome['status']; noteAr: string | null; reference: string | null }[];
}

export async function readStoredResult(bundle: string | null): Promise<StoredResult | null> {
  if (bundle === null) {
    return null;
  }
  try {
    const { cookies } = await import('next/headers');
    const raw = (await cookies()).get(RESULT_COOKIE)?.value;
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredResult;
    return parsed.bundle === bundle && Array.isArray(parsed.outcomes) ? parsed : null;
  } catch {
    return null;
  }
}
