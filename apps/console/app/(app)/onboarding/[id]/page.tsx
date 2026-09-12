import type { ReactElement } from 'react';
import { notFound } from 'next/navigation';
import { getCase, listCaseActions, listJourneys, listProducts } from '@nx-verify/core';
import {
  OnboardingCaseView,
  type CaseDetailView,
  type CaseStepView,
} from '../../../../components/onboarding-case';
import { query } from '../../../../lib/context';

export const dynamic = 'force-dynamic';

export default async function OnboardingCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;

  const view = await query(async (tx): Promise<CaseDetailView | null> => {
    const onboarding = await getCase(tx, id);
    if (!onboarding) {
      return null;
    }

    const [actions, journeys, products] = await Promise.all([
      listCaseActions(tx, id),
      listJourneys(tx),
      listProducts(tx),
    ]);
    const productName = new Map(products.map((product) => [product.code, product.nameAr]));
    const journeyName = new Map(journeys.map((journey) => [journey.code, journey.nameAr]));

    // The run references are read in one query rather than one per step: a file with ten
    // checks should not cost ten round trips to draw.
    const runIds = onboarding.steps
      .map((step) => step.runId)
      .filter((runId): runId is string => runId !== null);
    const runs = runIds.length
      ? await tx.query<{ id: string; reference: string | null; display_name: string | null }>(
          `SELECT r.id, r.reference, e.display_name
           FROM verification_runs r
           LEFT JOIN entities e ON e.tenant_id = r.tenant_id AND e.id = r.entity_id
           WHERE r.tenant_id = $1 AND r.id = ANY($2::uuid[])`,
          [tx.tenantId, runIds],
        )
      : { rows: [] as { id: string; reference: string | null; display_name: string | null }[] };
    const referenceOf = new Map(runs.rows.map((row) => [row.id, row.reference]));

    const entityName = onboarding.entityId
      ? ((
          await tx.query<{ display_name: string | null }>(
            `SELECT display_name FROM entities WHERE tenant_id = $1 AND id = $2`,
            [tx.tenantId, onboarding.entityId],
          )
        ).rows[0]?.display_name ?? null)
      : null;

    return {
      caseId: onboarding.caseId,
      reference: onboarding.reference,
      journeyNameAr: journeyName.get(onboarding.journeyCode) ?? onboarding.journeyCode,
      entityId: onboarding.entityId,
      entityName,
      status: onboarding.status,
      outcome: onboarding.outcome,
      clientRef: onboarding.clientRef,
      openedAt: onboarding.openedAt,
      dueAt: onboarding.dueAt,
      closedAt: onboarding.closedAt,
      overdue: onboarding.overdue,
      steps: onboarding.steps.map(
        (step): CaseStepView => ({
          stepKey: step.stepKey,
          productNameAr: productName.get(step.productCode) ?? step.productCode,
          required: step.required,
          status: step.status,
          runId: step.runId,
          runReference: step.runId ? (referenceOf.get(step.runId) ?? null) : null,
          waiveReason: step.waiveReason,
          decidedAt: step.decidedAt,
        }),
      ),
      actions: actions.map((action) => ({
        actionKey: action.actionKey,
        actionType: action.actionType,
        outcome: action.outcome,
        delivered: action.deliveryId !== null,
        at: action.at,
      })),
    };
  });

  if (!view) {
    notFound();
  }

  return <OnboardingCaseView view={view} />;
}
