import type { ReactElement } from 'react';
import { operatorCan, riskModel } from '@nx-verify/core';
import { OperatorRisk } from '../../../../../components/operator-risk';
import { SectionTabs } from '../../../../../components/section-tabs';
import { INTEGRATION_TABS } from '../../../../../components/operator-shell';
import { operatorOrSignIn, operatorQuery } from '../../../../../lib/operator';
import {
  setBandsAction,
  setCategoryRiskAction,
  setProductRiskAction,
  setSignalAction,
} from './actions';

/** Never prerendered, and refuses to render without a sign in. */
export const dynamic = 'force-dynamic';

const NOTICES: Readonly<Record<string, { tone: 'done' | 'refused'; text: string }>> = {
  signal: {
    tone: 'done',
    text: 'حُفظ المؤشر. يُطبَّق على كل درجة تُحسب من الآن، ويظهر بوزنه الجديد في أسباب الدرجة.',
  },
  bands: { tone: 'done', text: 'حُفظت الحدود. الدرجات لم تتغير، والكلمة التي تصفها تغيّرت.' },
  product: {
    tone: 'done',
    text: 'حُفظ احتساب الخطر لهذه الخدمة. مؤشراتها كلها تبعت القرار.',
  },
  category: {
    tone: 'done',
    text: 'حُفظ احتساب هذا النوع من الخطر. مؤشراته كلها تبعت القرار.',
  },
  'refused:invalid': {
    tone: 'refused',
    text: 'لم يُحفظ: الوزن من صفر إلى مئة، والعتبة رقم موجب، وحد «المتوسطة» أقل من حد «العالية».',
  },
  'refused:missing': { tone: 'refused', text: 'لم يُحفظ: لا مؤشر ولا خدمة بهذا الرمز.' },
};

/**
 * The risk model, set from the panel (ADR-138): what raises a score, by how much, and when.
 */
export default async function RiskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const operator = await operatorOrSignIn();
  const params = await searchParams;
  const refused = typeof params['refused'] === 'string' ? `refused:${params['refused']}` : null;
  const saved = typeof params['saved'] === 'string' ? params['saved'] : null;
  const notice =
    (refused === null ? undefined : NOTICES[refused]) ??
    (saved === null ? null : (NOTICES[saved] ?? null));

  const model = await operatorQuery((db) => riskModel(db));

  return (
    <div className="stack">
      <SectionTabs
        tabs={INTEGRATION_TABS}
        current="/operator/verification/risk"
        label="أقسام التحقق"
      />
      <OperatorRisk
        view={{ model, canEdit: operatorCan(operator.role, 'settings'), notice }}
        setSignalAction={setSignalAction}
        setBandsAction={setBandsAction}
        setProductAction={setProductRiskAction}
        setCategoryAction={setCategoryRiskAction}
      />
    </div>
  );
}
