import { NxError } from './errors.js';
import { stripProviderNames } from './logging/redact.js';

/**
 * The single door everything takes on its way to a caller.
 *
 * Rule 5: no provider name appears in any public response. The exposed provenance field
 * is `authority`, the official body. `source` is internal and stops here.
 *
 * Having one chokepoint matters more than the mapping itself. Rule 5 is easy to honour in
 * the handler someone writes today and easy to break in the handler someone writes in six
 * months, so every response is built here and `assertNoProviderLeak` can be pointed at
 * the result.
 */

export type PublicStepStatus = 'OK' | 'NOT_FOUND' | 'ERROR' | 'SKIPPED' | 'CACHED';

/** What the system knows about a step. Carries the provider, and never leaves the domain. */
export interface InternalStepRecord {
  stepKey: string;
  status: PublicStepStatus;
  /** Internal. Rule 5. */
  provider: string;
  /** Internal. Rule 5. */
  endpoint: string;
  authority: string | null;
  errorCode?: string | undefined;
  skippedBecause?: string | undefined;
  servedFromCache?: boolean | undefined;
  latencyMs?: number | undefined;
  providerCost?: number | undefined;
  billedAmount?: number | undefined;
}

/** What a caller sees for one step. */
export interface PublicStepResult {
  status: PublicStepStatus;
  authority?: string;
  reason?: string;
}

export function toPublicStepResult(step: InternalStepRecord): PublicStepResult {
  const result: PublicStepResult = { status: step.status };
  if (step.authority) {
    result.authority = step.authority;
  }
  if (step.skippedBecause) {
    result.reason = step.skippedBecause;
  }
  return result;
}

export interface PublicResults {
  [stepKey: string]: PublicStepResult;
}

export function toPublicResults(steps: readonly InternalStepRecord[]): PublicResults {
  const results: PublicResults = {};
  for (const step of steps) {
    results[step.stepKey] = toPublicStepResult(step);
  }
  return results;
}

/**
 * Deep check that no provider name survived into a payload.
 *
 * Used by guard 06 and by the API before it writes a response. A leak check that only
 * runs in tests protects only the paths tests cover.
 */
export function assertNoProviderLeak(payload: unknown, providerNames: readonly string[]): void {
  const serialized = JSON.stringify(payload) ?? '';
  const lowered = serialized.toLowerCase();

  for (const name of providerNames) {
    if (name.length > 0 && lowered.includes(name.toLowerCase())) {
      throw new NxError('NX-5001', {
        detail: 'a provider name reached a public payload',
      });
    }
  }
}

/**
 * Last line of defence for text that must go out but was not built here, such as a
 * message from an upstream library. Prefer building the payload above.
 */
export function scrubText(text: string, providerNames: readonly string[]): string {
  return stripProviderNames(text, providerNames);
}
