import type { ReactElement } from 'react';
import { listModules, operatorCan } from '@nx-verify/core';
import { OperatorModules } from '../../../../../components/operator-modules';
import { SectionTabs } from '../../../../../components/section-tabs';
import { PRICING_TABS } from '../../../../../components/operator-shell';
import { operatorOrSignIn, operatorQuery } from '../../../../../lib/operator';
import { setModuleDefaultAction } from './actions';
import { moduleNoticeAr } from './notice';

/** Never prerendered, and refuses to render without a sign in. */
export const dynamic = 'force-dynamic';

/**
 * The catalogue of modules (ADR-137): what each one adds to a customer file, what it sells,
 * how far the plans have drifted from what subscribers actually buy, and what a workspace
 * nobody has decided about is given.
 *
 * That last one is the column this screen could only read. `modules.default_on` is a row like
 * everything else about a module (rule 8), and its only writer was the seed file.
 */
export default async function ModulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const operator = await operatorOrSignIn();
  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };

  const modules = await operatorQuery((db) => listModules(db));

  return (
    <div className="stack">
      <SectionTabs tabs={PRICING_TABS} current="/operator/pricing/modules" label="أقسام الأسعار" />
      <OperatorModules
        view={{
          modules,
          canEdit: operatorCan(operator.role, 'pricing'),
          notice: moduleNoticeAr({
            refused: one('refused'),
            saved: one('saved'),
            name: one('name'),
            moved: one('moved'),
          }),
        }}
        setDefault={setModuleDefaultAction}
      />
    </div>
  );
}
