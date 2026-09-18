import type { ReactElement } from 'react';
import { NoAccess } from '../../../../components/no-access';
import {
  findExpiringFields,
  inboxSeenAt,
  listInbox,
  markInboxSeen,
  pageChangeEvents,
  slicePage,
} from '@nx-verify/core';
import { Monitoring, type StaleCustomerView } from '../../../../components/monitoring';
import type { FreshnessState } from '../../../../components/freshness';
import { SectionTabs } from '../../../../components/section-tabs';
import { CUSTOMER_TABS, visible } from '../../../../components/nav';
import { actingUser, query } from '../../../../lib/context';
import { pageRequestFrom, type SearchParams } from '../../../../lib/pagination';
import { Inbox } from '../../../../components/inbox';
import { PageHeader, Panel } from '../../../../components/page-header';
import { acknowledgeChangeAction } from './actions';

/** Never prerendered: one subscriber's live changes. */
export const dynamic = 'force-dynamic';

/**
 * The open alerts (handoff screen 00, «التنبيهات المفتوحة»).
 *
 * What arrived since this person last looked, then what changed in the customers' data and
 * which customers' facts have aged out. Opening the screen is what marks the arrivals read:
 * the timestamp is read before the sweep and written after it, so an item that lands while
 * the page renders is still new next time.
 */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const actor = await actingUser();
  if (!actor.can('customers.read')) {
    return <NoAccess needs="customers.read" />;
  }
  const data = await query(async (tx) => {
    const seenAt = await inboxSeenAt(tx, actor.userId);
    const inbox = await listInbox(tx, { seenAt });
    await markInboxSeen(tx, actor.userId);
    const changes = await pageChangeEvents(tx, { openOnly: true }, pageRequestFrom(params));
    const expiring = await findExpiringFields(tx, 500);

    const ids = [
      ...new Set([
        ...changes.rows.map((row) => row.entityId),
        ...expiring.map((row) => row.entityId),
      ]),
    ];
    const { rows: names } = ids.length
      ? await tx.query<{ id: string; display_name: string | null }>(
          `SELECT id, display_name FROM entities WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tx.tenantId, ids],
        )
      : { rows: [] as { id: string; display_name: string | null }[] };

    return {
      inbox,
      seenAt,
      changes,
      expiring,
      names: new Map(names.map((row) => [row.id, row.display_name])),
    };
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
      <SectionTabs tabs={visible(CUSTOMER_TABS, actor.capabilities)} current="/customers/alerts" label="أقسام العملاء" />
      <PageHeader
        title="التنبيهات المفتوحة"
        subtitle="ما وصل منذ آخر زيارة، وما تغيّر في بيانات عملائك، ومن قدمت معلوماته."
      />
      <Panel title="وصل حديثاً" aside={`${data.inbox.unread} جديد`} role="inbox-panel">
        <div className="panel-body">
          <Inbox items={data.inbox.items} seenAt={data.seenAt} heading={false} />
        </div>
      </Panel>
      <Monitoring
        heading={false}
        path="/customers/alerts"
        params={params}
        acknowledgeAction={acknowledgeChangeAction}
        changes={{
          ...data.changes,
          rows: data.changes.rows.map((change) => ({
            changeEventId: change.changeEventId,
            entityId: change.entityId,
            entityName: data.names.get(change.entityId) ?? null,
            fieldPath: change.fieldPath,
            severity: change.severity,
            reasonAr: change.reasonAr,
            detectedAt: change.detectedAt,
          })),
        }}
        stale={slicePage(
          [...byCustomer.values()].sort((left, right) => right.expired - left.expired),
          pageRequestFrom(params, 'stale'),
        )}
      />
    </div>
  );
}
