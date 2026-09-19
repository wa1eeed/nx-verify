import type { ReactElement } from 'react';
import { NoAccess } from '../../../../../components/no-access';
import { notFound } from 'next/navigation';
import { getCase, listCaseActions, listCaseSeals, listJourneys, listProducts } from '@nx-verify/core';
import {
  OnboardingCaseView,
  type CaseDetailView,
  type CaseStepView,
} from '../../../../../components/onboarding-case';
import { CaseBundlePanel, type CaseSealView } from './bundle';
import { actingUser, query } from '../../../../../lib/context';
import { advanceCaseAction, sealCaseBundleAction, waiveStepAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function OnboardingCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ outcome?: string }>;
}): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('customers.read')) {
    return <NoAccess needs="customers.read" />;
  }
  const { id } = await params;
  const { outcome } = await searchParams;

  const data = await query(async (tx): Promise<{ view: CaseDetailView; seals: CaseSealView[] } | null> => {
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

    const seals = await listCaseSeals(tx, id);

    const view: CaseDetailView = {
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
      steps: onboarding.steps.map((step): CaseStepView => ({
        stepKey: step.stepKey,
        productNameAr: productName.get(step.productCode) ?? step.productCode,
        required: step.required,
        status: step.status,
        runId: step.runId,
        runReference: step.runId ? (referenceOf.get(step.runId) ?? null) : null,
        waiveReason: step.waiveReason,
        decidedAt: step.decidedAt,
      })),
      actions: actions.map((action) => ({
        actionKey: action.actionKey,
        actionType: action.actionType,
        outcome: action.outcome,
        delivered: action.deliveryId !== null,
        at: action.at,
      })),
    };

    return {
      view,
      seals: seals.map((seal) => ({
        evidenceId: seal.evidenceId,
        contentHash: seal.contentHash,
        publicToken: seal.publicToken,
        signedAt: seal.signedAt,
      })),
    };
  });

  if (!data) {
    notFound();
  }

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <OnboardingCaseView
        view={data.view}
        outcome={outcome}
        advanceAction={advanceCaseAction}
        waiveAction={waiveStepAction}
      />
      <CaseBundlePanel
        caseId={data.view.caseId}
        runCount={data.view.steps.filter((step) => step.runId !== null).length}
        stepCount={data.view.steps.length}
        seals={data.seals}
        {...(actor.can('share.create') ? { action: sealCaseBundleAction } : {})}
        outcome={outcome}
      />
    </div>
  );
}
