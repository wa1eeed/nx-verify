import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import {
  getSubscriberDetail,
  listCatalog,
  listPlans,
  listSpecialPrices,
  listTenantBindings,
  operatorCan,
  subscribersBoard,
  tenantModules,
  tenantRiskModel,
} from '@nx-verify/core';
import { secretStoreFromEnv } from '@nx-verify/providers';
import { AdminSubscriber } from '../../../../../components/admin-subscribers/detail';
import {
  BINDING_NOTICES,
  OperatorBinding,
  type OperatorBindingView,
} from '../../../../../components/operator-binding';
import { SectionTabs } from '../../../../../components/section-tabs';
import { SUBSCRIBER_TABS } from '../../../../../components/operator-shell';
import { operatorOrSignIn, operatorQuery } from '../../../../../lib/operator';
import {
  assignPlanAction,
  setModuleAction,
  setRiskBandsAction,
  setRiskCategoryAction,
  setRiskSignalAction,
  setSuspendedAction,
} from '../actions';
import { setSourceAction } from './actions';
import { credentialState } from './credential';

/** Never prerendered, and refuses to render without a sign in. */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What happened to the subscriber, said at the top of the screen where the subscriber is.
 *
 * Everything the binding card writes says so in the binding card instead (BINDING_NOTICES),
 * because that card is the last section of a long page and its form is at the bottom of it
 * (ADR-179). The two maps share no key: one query names one outcome, and it is found in the
 * map of the section that produced it and in no other.
 */
const NOTICES: Readonly<Record<string, { tone: 'done' | 'refused'; text: string }>> = {
  'saved:suspended': {
    tone: 'done',
    text: 'أُوقف المشترك: لا تُقبل له عملية تحقق حتى يُعاد تفعيله، وبياناته ورصيده وحزمه كما هي.',
  },
  'saved:resumed': { tone: 'done', text: 'أُعيد تفعيل المشترك.' },
  'saved:plan': { tone: 'done', text: 'نُقل المشترك إلى الباقة.' },
  'refused:plan': { tone: 'refused', text: 'لم يُنقل: الباقة المختارة غير معروضة.' },
  'saved:module': {
    tone: 'done',
    text: 'حُفظ قرار الوحدة. أقسامه تظهر أو تختفي من ملفات عملاء هذا المشترك من الآن، وتُقبل خدماته أو تُرفض على الواجهة البرمجية معها.',
  },
  'saved:module_cleared': {
    tone: 'done',
    text: 'رُفع القرار الخاص. يرث هذا المشترك الوحدة من باقته ومن الافتراضي مرة أخرى.',
  },
  'refused:module': {
    tone: 'refused',
    text: 'لم يُحفظ: هذه الوحدة أساس كل ملف عميل ولا يمكن تعطيلها.',
  },
  'saved:risk': {
    tone: 'done',
    text: 'حُفظ تخصيص المؤشر لهذا المشترك. يُطبَّق على كل درجة تُحسب له من الآن، ولا يمس أحداً غيره.',
  },
  'saved:risk_cleared': {
    tone: 'done',
    text: 'رُفع التخصيص. يرث هذا المشترك نموذج المنصة مرة أخرى، ويصله أي تحسين عليه.',
  },
  'refused:risk': {
    tone: 'refused',
    text: 'لم يُحفظ: الوزن من صفر إلى مئة، والعتبة رقم موجب، وحد «المتوسطة» أقل من حد «العالية».',
  },
};

export default async function OperatorSubscriberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const operator = await operatorOrSignIn();
  const { id } = await params;
  // Checked before the query, so a mistyped address is a missing page rather than a database
  // error about a malformed uuid.
  if (!UUID.test(id)) {
    notFound();
  }
  const query = await searchParams;

  const data = await operatorQuery(async (db) => ({
    detail: await getSubscriberDetail(db, id),
    board: await subscribersBoard(db),
    plans: await listPlans(db),
    special: (await listSpecialPrices(db)).find((entry) => entry.tenantId === id) ?? null,
    modules: await tenantModules(db, id),
    risk: await tenantRiskModel(db, id),
    bindings: await listTenantBindings(db, id),
    catalogue: await listCatalog(db),
  }));
  const row = data.board.rows.find((entry) => entry.tenantId === id);
  if (!data.detail || !row) {
    notFound();
  }

  const key =
    typeof query['refused'] === 'string'
      ? `refused:${query['refused']}`
      : typeof query['saved'] === 'string'
        ? `saved:${query['saved']}`
        : null;

  const store = secretStoreFromEnv();
  const bindingView: OperatorBindingView = {
    bindings: await Promise.all(
      data.bindings.map(async (binding) => ({
        provider: binding.provider,
        nameAr:
          data.catalogue.find((entry) => entry.code === binding.provider)?.nameAr ??
          binding.provider,
        mode: binding.mode,
        // Described, never fetched for display: the screen learns which fields are set behind
        // the reference and a fingerprint of each, and no value reaches the page (rule 10).
        // A store that does not answer is carried as its own state rather than as an absence,
        // because those are different things to say (ADR-179).
        credential: await credentialState(store, binding.credentialRef),
        priority: binding.priority,
        healthStatus: binding.healthStatus,
        activatedAt: binding.activatedAt,
      })),
    ),
    catalogue: data.catalogue
      .filter((entry) => entry.status === 'active')
      .map((entry) => ({ code: entry.code, nameAr: entry.nameAr })),
    notice: key === null ? null : (BINDING_NOTICES[key] ?? null),
    // Whose account a subscriber runs on is the permission that guards every other provider
    // credential, not the one that moves plans and stops accounts.
    canManage: operatorCan(operator.role, 'integration'),
  };

  return (
    <div className="admin-screen">
      <SectionTabs tabs={SUBSCRIBER_TABS} current="/operator/subscribers" label="أقسام المشتركين" />
      <AdminSubscriber
        view={{
          detail: data.detail,
          row,
          canManage: operatorCan(operator.role, 'subscribers'),
          plans: data.plans.map((plan) => ({ code: plan.code, nameAr: plan.nameAr })),
          specialPrice: data.special,
          modules: data.modules,
          risk: data.risk,
          // The binding surface is rendered below rather than inside the detail component
          // (ADR-172): it is the one section of this page whose write crosses into the panel's
          // own trail and into the platform's cost of serving this subscriber, and it says so
          // in its own words, including what it says after a save (ADR-179).
          notice: key === null ? null : (NOTICES[key] ?? null),
        }}
        actions={{
          setSuspended: setSuspendedAction,
          assignPlan: assignPlanAction,
          setModule: setModuleAction,
          setRiskSignal: setRiskSignalAction,
          setRiskBands: setRiskBandsAction,
          setRiskCategory: setRiskCategoryAction,
        }}
      />
      <OperatorBinding tenantId={id} view={bindingView} setBinding={setSourceAction} />
    </div>
  );
}
