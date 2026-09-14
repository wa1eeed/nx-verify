import type { ReactElement } from 'react';
import { countQueue, pageQueue, type Page } from '@nx-verify/core';
import { ReviewQueue, type QueueRowView } from '../../../../components/review-queue';
import { query } from '../../../../lib/context';
import { pageRequestFrom, type SearchParams } from '../../../../lib/pagination';
import { SectionTabs } from '../../../../components/section-tabs';
import { CUSTOMER_TABS } from '../../../../components/nav';

/**
 * Never prerendered and never cached.
 *
 * This page reads one tenant's live data, and a build machine has no database and no
 * business holding a copy of it. Rendering it at request time is also what keeps a page
 * from showing a snapshot of somebody else's tenant after a deployment.
 */
export const dynamic = 'force-dynamic';

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const { page, overdue } = await query(async (tx) => {
    const queue = await pageQueue(tx, {}, pageRequestFrom(params));
    const overdue = await countQueue(tx, { overdueOnly: true });
    if (queue.rows.length === 0) {
      return { page: { ...queue, rows: [] } as Page<QueueRowView>, overdue };
    }

    const { rows: names } = await tx.query<{ id: string; display_name: string | null }>(
      `SELECT id, display_name FROM entities WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tx.tenantId, queue.rows.map((item) => item.entityId)],
    );
    const byId = new Map(names.map((row) => [row.id, row.display_name]));

    const rows = queue.rows.map((item): QueueRowView => ({
      caseId: item.caseId,
      entityId: item.entityId,
      entityName: byId.get(item.entityId) ?? null,
      reasonCodes: item.reasonCodes,
      status: item.status,
      assignedTo: item.assignedTo,
      decidedBy: item.decidedBy,
      ageHours: item.ageHours,
      overdue: item.overdue,
    }));
    return { page: { ...queue, rows }, overdue };
  });

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={CUSTOMER_TABS} current="/customers/reviews" label="أقسام العملاء" />
      <ReviewQueue page={page} overdue={overdue} params={params} />
    </div>
  );
}
