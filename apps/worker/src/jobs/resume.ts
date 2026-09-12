import {
  abandonRun,
  expireWaits,
  matchWaits,
  resumeRun,
  type StepRunner,
  type TenantKeyProvider,
} from '@nx-verify/core';
import type { TenantTransaction } from '@nx-verify/db';

/**
 * The other half of an asynchronous verification.
 *
 * A provider's callback lands in a table that belongs to no subscriber, because it
 * arrives before we know whose it is. This job is where it becomes one subscriber's:
 * running inside a tenant's own scope, it asks whether any delivery matches a wait that
 * tenant is holding. The isolation is never relaxed to make the join possible, and the
 * delivery never learns whose it was.
 *
 * Expiry runs first and on purpose. A provider that never answers must not leave a run
 * open for ever: the customer is told nothing, a case stays open against an answer that
 * is not coming, and nobody can see which of the two is happening.
 */

export interface ResumeOptions {
  keys: TenantKeyProvider;
  runStep: StepRunner;
  limit?: number;
}

export interface ResumeSummary {
  expired: number;
  resumed: number;
  failed: number;
}

export async function resumeAwaitingRuns(
  tx: TenantTransaction,
  options: ResumeOptions,
): Promise<ResumeSummary> {
  const summary: ResumeSummary = { expired: 0, resumed: 0, failed: 0 };

  for (const runId of await expireWaits(tx)) {
    await abandonRun(tx, runId);
    summary.expired += 1;
  }

  const matched = await matchWaits(tx, options.limit ?? 50);
  for (const wait of matched) {
    try {
      const result = await resumeRun(tx, {
        waitId: wait.waitId,
        runStep: options.runStep,
        keys: options.keys,
      });
      if (result) {
        summary.resumed += 1;
      }
    } catch {
      // Counted and moved past. One subscriber's unresumable run must not stop the
      // others, and the run is still visible as awaiting until its wait expires.
      summary.failed += 1;
    }
  }

  return summary;
}
