import type { ReactElement } from 'react';
import { serviceRouting } from '@nx-verify/core';
import { OperatorRouting } from '../../../../../components/operator-routing';
import { SectionTabs } from '../../../../../components/section-tabs';
import { INTEGRATION_TABS } from '../../../../../components/operator-shell';
import { operatorOrSignIn, operatorQuery } from '../../../../../lib/operator';
import { removeRouteAction, setRouteAction } from './actions';

/** Never prerendered, and refuses to render without a sign in. */
export const dynamic = 'force-dynamic';

const NOTICES: Readonly<Record<string, { tone: 'done' | 'refused'; text: string }>> = {
  routed: {
    tone: 'done',
    text: 'حُفظ التوجيه. النداء التالي لهذه الخدمة يذهب إلى المزوّد المعيّن، وجدول النداءات أدناه يثبت ذلك خلال دقائق.',
  },
  removed: { tone: 'done', text: 'أُزيل المزوّد من هذه الخدمة.' },
  'refused:invalid': { tone: 'refused', text: 'لم يُحفظ: تحقق من الخدمة والمزوّد والترتيب.' },
  'refused:missing': { tone: 'refused', text: 'هذا المزوّد ليس معيّناً على هذه الخدمة.' },
};

/**
 * Which provider serves each verification service (ADR-135).
 *
 * The owner's screen for the decision that used to require a catalogue edit and a release:
 * a provider raised its price, so this service moves to the other one, for every subscriber,
 * now. And beside it the proof that the calls followed.
 */
export default async function RoutingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  await operatorOrSignIn();
  const params = await searchParams;
  const refused = typeof params['refused'] === 'string' ? `refused:${params['refused']}` : null;
  const saved = typeof params['saved'] === 'string' ? params['saved'] : null;
  const notice =
    (refused === null ? undefined : NOTICES[refused]) ??
    (saved === null ? null : (NOTICES[saved] ?? null));

  const services = await operatorQuery((db) => serviceRouting(db));

  return (
    <div className="stack">
      <SectionTabs
        tabs={INTEGRATION_TABS}
        current="/operator/verification/routing"
        label="أقسام التحقق"
      />
      <OperatorRouting
        view={{ services, notice, now: new Date() }}
        setRouteAction={setRouteAction}
        removeRouteAction={removeRouteAction}
      />
    </div>
  );
}
