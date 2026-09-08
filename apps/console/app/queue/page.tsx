import type { ReactElement } from 'react';
import { listQueue } from '@nx-verify/core';
import { ReviewQueue, type QueueRowView } from '../../components/review-queue';
import { query } from '../../lib/context';

/**
 * Never prerendered and never cached.
 *
 * This page reads one tenant's live data, and a build machine has no database and no
 * business holding a copy of it. Rendering it at request time is also what keeps a page
 * from showing a snapshot of somebody else's tenant after a deployment.
 */
export const dynamic = 'force-dynamic';

export default async function QueuePage(): Promise<ReactElement> {
  const rows = await query(async (tx) => {
    const queue = await listQueue(tx, { limit: 100 });
    if (queue.length === 0) {
      return [] as QueueRowView[];
    }

    const { rows: names } = await tx.query<{ id: string; display_name: string | null }>(
      `SELECT id, display_name FROM entities WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tx.tenantId, queue.map((item) => item.entityId)],
    );
    const byId = new Map(names.map((row) => [row.id, row.display_name]));

    return queue.map((item): QueueRowView => ({
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
  });

  return <ReviewQueue rows={rows} />;
}
