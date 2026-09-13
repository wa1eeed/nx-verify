import type { ReactElement } from 'react';
import { findExpiringFields, listChangeEvents } from '@nx-verify/core';
import { Monitoring, type StaleCustomerView } from '../../../components/monitoring';
import type { FreshnessState } from '../../../components/freshness';
import { SectionTabs } from '../../../components/section-tabs';
import { MONITORING_TABS } from '../../../components/nav';
import { query } from '../../../lib/context';

/** Never prerendered: one subscriber's live changes. */
export const dynamic = 'force-dynamic';

export default async function MonitoringPage(): Promise<ReactElement> {
  const data = await query(async (tx) => {
    const changes = await listChangeEvents(tx, { openOnly: true, limit: 100 });
    const expiring = await findExpiringFields(tx, 500);

    const ids = [...new Set([...changes.map((row) => row.entityId), ...expiring.map((row) => row.entityId)])];
    const { rows: names } = ids.length
      ? await tx.query<{ id: string; display_name: string | null }>(
          `SELECT id, display_name FROM entities WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tx.tenantId, ids],
        )
      : { rows: [] as { id: string; display_name: string | null }[] };

    return { changes, expiring, names: new Map(names.map((row) => [row.id, row.display_name])) };
  });

  // One row per customer rather than per fact: a person re-verifies a customer, not a field.
  const byCustomer = new Map<string, StaleCustomerView>();
  for (const field of data.expiring) {
    const entry =
      byCustomer.get(field.entityId) ??
      ({
        entityId: field.entityId,
        entityName: data.names.get(field.entityId) ?? null,
        expired: 0,
        expiring: 0,
        soonest: null,
        fields: [],
      } satisfies StaleCustomerView);
    if (field.freshness === 'expired') {
      entry.expired += 1;
    } else {
      entry.expiring += 1;
    }
    if (field.effectiveUntil && (entry.soonest === null || field.effectiveUntil < entry.soonest)) {
      entry.soonest = field.effectiveUntil;
    }
    entry.fields.push({ fieldPath: field.fieldPath, freshness: field.freshness as FreshnessState });
    byCustomer.set(field.entityId, entry);
  }

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={MONITORING_TABS} current="/monitoring" label="أقسام المراقبة" />
      <Monitoring
        changes={data.changes.map((change) => ({
          changeEventId: change.changeEventId,
          entityId: change.entityId,
          entityName: data.names.get(change.entityId) ?? null,
          fieldPath: change.fieldPath,
          severity: change.severity,
          reasonAr: change.reasonAr,
          detectedAt: change.detectedAt,
        }))}
        stale={[...byCustomer.values()].sort((left, right) => right.expired - left.expired)}
      />
    </div>
  );
}
