import {
  claimBatchItems,
  recordBatchItem,
  revealIdentifier,
  verify,
  NxError,
  type StepRunner,
  type TenantKeyProvider,
} from '@nx-verify/core';
import type { TenantTransaction } from '@nx-verify/db';

/**
 * Running a confirmed batch.
 *
 * Items are claimed a few at a time with SKIP LOCKED, so several workers can share a
 * batch and a crash loses at most the items in flight. Each item is an ordinary
 * verification, which means it is billed, normalised, decided and queued for review by
 * exactly the same code as a single request. A batch is a way of asking, not a second
 * pipeline.
 */

export interface RunBatchesOptions {
  keys: TenantKeyProvider;
  runStep: StepRunner;
  limit?: number;
}

export interface BatchItemSummary {
  batchId: string;
  entityId: string;
  status: 'DONE' | 'FAILED' | 'SKIPPED';
  cost: number;
}

export async function runBatchItems(
  tx: TenantTransaction,
  options: RunBatchesOptions,
): Promise<BatchItemSummary[]> {
  const items = await claimBatchItems(tx, options.limit ?? 20);
  const summaries: BatchItemSummary[] = [];

  for (const item of items) {
    const identifier = await revealIdentifier(tx, options.keys, item.entityId, [
      'UNN',
      'CR',
      'IBAN',
    ]);

    if (!identifier) {
      // Nothing to ask the authority about. Skipped, and skipped costs nothing.
      await recordBatchItem(tx, item.batchId, item.entityId, {
        status: 'SKIPPED',
        errorCode: 'NO_IDENTIFIER',
      });
      summaries.push({
        batchId: item.batchId,
        entityId: item.entityId,
        status: 'SKIPPED',
        cost: 0,
      });
      continue;
    }

    const subjectKey =
      identifier.idType === 'UNN' ? 'unn' : identifier.idType === 'CR' ? 'cr_number' : 'iban';

    try {
      const result = await verify(tx, {
        productCode: item.productCode,
        subject: { [subjectKey]: identifier.value },
        subjectIdentifiers: [{ idType: identifier.idType, value: identifier.value }],
        triggeredBy: 'BULK',
        modeAtExecution: 'BYOC',
        runStep: options.runStep,
        keys: options.keys,
      });

      await recordBatchItem(tx, item.batchId, item.entityId, {
        status: 'DONE',
        runId: result.runId,
        cost: result.billing.amount,
      });
      summaries.push({
        batchId: item.batchId,
        entityId: item.entityId,
        status: 'DONE',
        cost: result.billing.amount,
      });
    } catch (error) {
      // One bad entity does not stop a batch of four hundred. The failure is recorded
      // against the item, with our own error code and nothing from a provider.
      await recordBatchItem(tx, item.batchId, item.entityId, {
        status: 'FAILED',
        errorCode: error instanceof NxError ? error.code : 'NX-5001',
      });
      summaries.push({
        batchId: item.batchId,
        entityId: item.entityId,
        status: 'FAILED',
        cost: 0,
      });
    }
  }

  return summaries;
}
