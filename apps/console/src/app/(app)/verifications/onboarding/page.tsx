import type { ReactElement } from 'react';
import { NoAccess } from '../../../../components/no-access';
import { caseTallies, listJourneys, pageCases, type Page } from '@nx-verify/core';
import { OnboardingList, type CaseRowView } from '../../../../components/onboarding';
import { actingUser, query } from '../../../../lib/context';
import { pageRequestFrom, type SearchParams } from '../../../../lib/pagination';
import { SectionTabs } from '../../../../components/section-tabs';
import { VERIFICATION_TABS, visible } from '../../../../components/nav';

/** Never prerendered: one subscriber's live files. */
export const dynamic = 'force-dynamic';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('customers.read')) {
    return <NoAccess needs="customers.read" />;
  }
  const params = await searchParams;
  const { page, tallies } = await query(async (tx) => {
    // Sequential: one connection, one transaction, one query at a time.
    const cases = await pageCases(tx, {}, pageRequestFrom(params));
    const tallies = await caseTallies(tx);
    const journeys = await listJourneys(tx);
    const rows = cases.rows;
    const journeyName = new Map(journeys.map((journey) => [journey.code, journey.nameAr]));

    const entityIds = rows.map((row) => row.entityId).filter((id): id is string => id !== null);
    const names = entityIds.length
      ? await tx.query<{ id: string; display_name: string | null }>(
          `SELECT id, display_name FROM entities WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tx.tenantId, entityIds],
        )
      : { rows: [] as { id: string; display_name: string | null }[] };
    const nameOf = new Map(names.rows.map((row) => [row.id, row.display_name]));

    const views = rows.map((row): CaseRowView => ({
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
    return { page: { ...cases, rows: views } as Page<CaseRowView>, tallies };
  });

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs
        tabs={visible(VERIFICATION_TABS, actor.capabilities)}
        current="/verifications/onboarding"
        label="أقسام التحقق"
      />
      <OnboardingList page={page} tallies={tallies} params={params} />
    </div>
  );
}
