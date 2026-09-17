import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { canApprove, canDecide, getReviewCase } from '@nx-verify/core';
import { ReviewCase, type ReviewCaseView } from '../../../../../components/review-case';
import { actingUser, query } from '../../../../../lib/context';
import { SectionTabs } from '../../../../../components/section-tabs';
import { CUSTOMER_TABS } from '../../../../../components/nav';
import { approveCaseAction, assignCaseAction, decideCaseAction, returnCaseAction } from './actions';

/** Never prerendered: one case, in one workspace, read at request time. */
export const dynamic = 'force-dynamic';

export default async function ReviewCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const { id } = await params;
  const search = await searchParams;
  const user = await actingUser();

  const view = await query(async (tx): Promise<ReviewCaseView | null> => {
    const item = await getReviewCase(tx, id);
    if (item === null) {
      return null;
    }

    // Names for the two people on the case and the customer it is about, read in the same
    // scope the case was: a name from another workspace must not reach this screen.
    const ids = [item.assignedTo, item.decidedBy].filter(
      (value): value is string => value !== null,
    );
    const { rows: people } = ids.length
      ? await tx.query<{ id: string; display_name: string }>(
          `SELECT id, display_name FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tx.tenantId, ids],
        )
      : { rows: [] as { id: string; display_name: string }[] };
    const nameOf = new Map(people.map((row) => [row.id, row.display_name]));

    const { rows: entity } = await tx.query<{ display_name: string | null }>(
      `SELECT display_name FROM entities WHERE tenant_id = $1 AND id = $2`,
      [tx.tenantId, item.entityId],
    );

    return {
      caseId: item.caseId,
      entityId: item.entityId,
      entityName: entity[0]?.display_name ?? null,
      status: item.status,
      reasonCodes: item.reasonCodes,
      priority: item.priority,
      assignedTo: item.assignedTo,
      assignedToName: item.assignedTo === null ? null : (nameOf.get(item.assignedTo) ?? null),
      outcome: item.outcome,
      decidedBy: item.decidedBy,
      decidedByName: item.decidedBy === null ? null : (nameOf.get(item.decidedBy) ?? null),
      decisionNote: item.decisionNote,
      openedAt: item.openedAt,
      slaDueAt: item.slaDueAt,
      ageHours: item.ageHours,
      overdue: item.overdue,
    };
  });

  if (view === null) {
    notFound();
  }

  const one = (key: string): string | undefined => {
    const value = search[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={CUSTOMER_TABS} current="/customers/reviews" label="أقسام العملاء" />
      <ReviewCase
        item={view}
        viewerId={user.userId}
        canDecide={canDecide(user.role)}
        canApprove={canApprove(user.role)}
        outcome={one('outcome')}
        assignAction={assignCaseAction}
        decideAction={decideCaseAction}
        approveAction={approveCaseAction}
        returnAction={returnCaseAction}
      />
    </div>
  );
}
