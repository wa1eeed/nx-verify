import type { ReactElement } from 'react';
import { listModules } from '@nx-verify/core';
import { OperatorModules } from '../../../../../components/operator-modules';
import { SectionTabs } from '../../../../../components/section-tabs';
import { PRICING_TABS } from '../../../../../components/operator-shell';
import { operatorOrSignIn, operatorQuery } from '../../../../../lib/operator';

/** Never prerendered, and refuses to render without a sign in. */
export const dynamic = 'force-dynamic';

/**
 * The catalogue of modules (ADR-137): what each one adds to a customer file, what it sells,
 * and how far the plans have drifted from what subscribers actually buy.
 */
export default async function ModulesPage(): Promise<ReactElement> {
  await operatorOrSignIn();
  const modules = await operatorQuery((db) => listModules(db));

  return (
    <div className="stack">
      <SectionTabs tabs={PRICING_TABS} current="/operator/pricing/modules" label="أقسام الأسعار" />
      <OperatorModules view={{ modules }} />
    </div>
  );
}
