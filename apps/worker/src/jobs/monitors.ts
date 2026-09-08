import {
  budgetRemaining,
  claimDueMonitors,
  computeScore,
  maximumCharge,
  queueEvent,
  recordMonitorSpend,
  resolvePrice,
  scheduleNextRun,
  revealIdentifier,
  storeScore,
  verify,
  type IdentifierType,
  type TenantKeyProvider,
} from '@nx-verify/core';
import type { StepRunner } from '@nx-verify/core';
import type { TenantTransaction } from '@nx-verify/db';

/**
 * The scheduled re-verification job.
 *
 * The order matters. The budget is checked before anything is called, so a cap is a cap
 * rather than a report. A monitor that cannot afford its next run is paused and says so,
 * because silently skipping a run is how a customer discovers months later that nothing
 * has been watched.
 */

export interface RunMonitorsOptions {
  keys: TenantKeyProvider;
  runStep: StepRunner;
  now?: Date;
  limit?: number;
}

export interface MonitorRunSummary {
  monitorId: string;
  outcome: 'ran' | 'over_budget' | 'failed';
  runId?: string;
  changes: number;
  spent: number;
}

export async function runDueMonitors(
  tx: TenantTransaction,
  options: RunMonitorsOptions,
): Promise<MonitorRunSummary[]> {
  const now = options.now ?? new Date();
  const due = await claimDueMonitors(tx, options.limit ?? 25, now);
  const summaries: MonitorRunSummary[] = [];

  for (const monitor of due) {
    const remaining = await budgetRemaining(tx, monitor.monitorId, now);
    const price = await resolvePrice(tx, monitor.productCode);
    const worstCase = maximumCharge(price);

    if (remaining < worstCase) {
      // Refused before the call, not after. The monitor stays as it is and the customer
      // is told, rather than the run happening and the cap being noticed afterwards.
      await recordMonitorSpend(tx, monitor.monitorId, remaining);
      await queueEvent(tx, {
        eventType: 'wallet.low',
        payload: {
          monitor_id: monitor.monitorId,
          entity_id: monitor.entityId,
          reason: 'monitor_budget_exhausted',
        },
      });
      summaries.push({
        monitorId: monitor.monitorId,
        outcome: 'over_budget',
        changes: 0,
        spent: 0,
      });
      continue;
    }

    const subject = await subjectFor(tx, options.keys, monitor.entityId);
    if (!subject) {
      summaries.push({ monitorId: monitor.monitorId, outcome: 'failed', changes: 0, spent: 0 });
      await scheduleNextRun(tx, monitor.monitorId, monitor.cadence, now);
      continue;
    }

    const result = await verify(tx, {
      productCode: monitor.productCode,
      subject: subject.subject,
      subjectIdentifiers: subject.identifiers,
      triggeredBy: 'MONITOR',
      modeAtExecution: 'BYOC',
      runStep: options.runStep,
      keys: options.keys,
    });

    await recordMonitorSpend(tx, monitor.monitorId, result.billing.amount, now);
    await scheduleNextRun(tx, monitor.monitorId, monitor.cadence, now);

    const changes = result.normalised?.changes ?? [];
    for (const change of changes) {
      await queueEvent(tx, {
        eventType: 'entity.changed',
        payload: {
          entity_id: change.entityId,
          field_path: change.fieldPath,
          severity: change.severity,
          change_event_id: change.changeEventId,
          verification_id: result.runId,
        },
      });
    }

    if (result.entityId) {
      await storeScore(tx, await computeScore(tx, result.entityId));
    }

    summaries.push({
      monitorId: monitor.monitorId,
      outcome: 'ran',
      runId: result.runId,
      changes: changes.length,
      spent: result.billing.amount,
    });
  }

  return summaries;
}

interface MonitorSubject {
  subject: Record<string, unknown>;
  identifiers: { idType: IdentifierType; value: string }[];
}

/**
 * Rebuilds the subject for a monitored entity.
 *
 * The identifier is decrypted from entity_identifiers rather than stored on the monitor,
 * because rule 4 forbids keeping it in the clear anywhere. It is decrypted for exactly as
 * long as the outbound call takes, and the key that decrypts it belongs to this tenant
 * alone.
 */
async function subjectFor(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  entityId: string,
): Promise<MonitorSubject | null> {
  const identifier = await revealIdentifier(tx, keys, entityId, ['UNN', 'CR', 'IBAN']);
  if (!identifier) {
    return null;
  }

  const subjectKey =
    identifier.idType === 'UNN' ? 'unn' : identifier.idType === 'CR' ? 'cr_number' : 'iban';

  return {
    subject: { [subjectKey]: identifier.value },
    identifiers: [{ idType: identifier.idType, value: identifier.value }],
  };
}
