import type { ReactElement } from 'react';
import { listJourneys } from '@nx-verify/core';
import { OpenCase } from '../../../../../components/onboarding-open';
import { query } from '../../../../../lib/context';
import { SectionTabs } from '../../../../../components/section-tabs';
import { VERIFICATION_TABS } from '../../../../../components/nav';
import { openCaseAction } from './actions';

/** Never prerendered: one subscriber's journeys, read at request time. */
export const dynamic = 'force-dynamic';

export default async function NewOnboardingCasePage({
  searchParams,
}: {
  searchParams: Promise<{ refused?: string }>;
}): Promise<ReactElement> {
  const { refused } = await searchParams;
  const journeys = await query(listJourneys);

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs
        tabs={VERIFICATION_TABS}
        current="/verifications/onboarding"
        label="أقسام التحقق"
      />
      <OpenCase
        journeys={journeys.map((journey) => ({
          code: journey.code,
          nameAr: journey.nameAr,
          descriptionAr: journey.descriptionAr,
          stepCount: journey.steps.length,
          slaHours: journey.slaHours,
        }))}
        refused={refused}
        action={openCaseAction}
      />
    </div>
  );
}
