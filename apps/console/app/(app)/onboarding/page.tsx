import type { ReactElement } from 'react';
import { listCases, listJourneys } from '@nx-verify/core';
import { OnboardingList, type CaseRowView } from '../../../components/onboarding';
import { query } from '../../../lib/context';

/** Never prerendered: one subscriber's live files. */
export const dynamic = 'force-dynamic';

export default async function OnboardingPage(): Promise<ReactElement> {
  const cases = await query(async (tx): Promise<CaseRowView[]> => {
    const [rows, journeys] = await Promise.all([listCases(tx, { limit: 100 }), listJourneys(tx)]);
    const journeyName = new Map(journeys.map((journey) => [journey.code, journey.nameAr]));

    const entityIds = rows.map((row) => row.entityId).filter((id): id is string => id !== null);
    const names = entityIds.length
      ? await tx.query<{ id: string; display_name: string | null }>(
          `SELECT id, display_name FROM entities WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tx.tenantId, entityIds],
        )
      : { rows: [] as { id: string; display_name: string | null }[] };
    const nameOf = new Map(names.rows.map((row) => [row.id, row.display_name]));

    return rows.map((row) => ({
      caseId: row.caseId,
      reference: row.reference,
      journeyNameAr: journeyName.get(row.journeyCode) ?? row.journeyCode,
      entityName: row.entityId ? (nameOf.get(row.entityId) ?? null) : null,
      status: row.status,
      outcome: row.outcome,
      done: row.done,
      total: row.total,
      dueAt: row.dueAt,
      overdue: row.overdue,
    }));
  });

  return <OnboardingList cases={cases} />;
}
