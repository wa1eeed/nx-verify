import type { ReactElement } from 'react';
import { NoAccess } from '../../../../../components/no-access';
import {
  getVerification,
  latestSandboxRequest,
  listApiKeys,
  listProducts,
  sandboxLink,
} from '@nx-verify/core';
import { SANDBOX_TEST_CASES, SCENARIO_NAMES } from '@nx-verify/providers';
import { Developer, type DeveloperView } from '../../../../../components/developer';
import { SandboxAccess, type SandboxAccessView } from '../../../../../components/sandbox-access';
import { actingUser, query } from '../../../../../lib/context';
import { requestSandboxAction, runPlaygroundAction } from './actions';
import { SectionTabs } from '../../../../../components/section-tabs';
import { DEVELOPER_TABS, SETTINGS_TABS, visible } from '../../../../../components/nav';

export const dynamic = 'force-dynamic';

export default async function DeveloperPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('developers.manage')) {
    return <NoAccess needs="developers.manage" />;
  }
  const params = await searchParams;
  const runId = typeof params['run'] === 'string' ? params['run'] : null;
  const error = typeof params['error'] === 'string' ? params['error'] : null;

  const { view, access } = await query(
    async (tx): Promise<{ view: DeveloperView; access: SandboxAccessView | null }> => {
      const [workspace, keys, products] = await Promise.all([
        sandboxLink(tx),
        listApiKeys(tx),
        listProducts(tx),
      ]);
      const active = keys.find((key) => key.revokedAt === null);

      // The playground's result is a real verification, so it is read back rather than
      // carried through the address.
      const run = runId ? await getVerification(tx, runId) : null;

      // A sandbox has no sandbox of its own, so the card is not offered there at all.
      const asked = workspace.isSandbox ? null : await latestSandboxRequest(tx);

      return {
        view: {
          isSandbox: workspace.isSandbox,
          apiBaseUrl: process.env['NX_API_URL'] ?? 'https://api.nx.sa',
          keyPrefix: active?.keyPrefix ?? null,
          // Published from the same table the sandbox answers from, so a documented case
          // cannot become one that does not work.
          testCases: SANDBOX_TEST_CASES.map((testCase) => ({
            input: testCase.input,
            productCode: testCase.productCode,
            scenario: testCase.scenario,
            titleAr: testCase.titleAr,
            expectedAr: testCase.expectedAr,
          })),
          scenarioNames: [...SCENARIO_NAMES],
          products: products.map((product) => ({ code: product.code, nameAr: product.nameAr })),
          lastRun: run
            ? {
                reference: run.reference,
                status: run.status,
                decision: run.decision,
                response: {
                  environment: workspace.isSandbox ? 'sandbox' : 'live',
                  verification_id: run.runId,
                  reference: run.reference,
                  product: run.productCode,
                  status: run.status,
                  decision: run.decision,
                  entity_id: run.entityId,
                  results: Object.fromEntries(
                    run.steps.map((step) => [step.stepKey, { status: step.status }]),
                  ),
                },
                latencyMs: null,
              }
            : null,
          error: error === 'live' || error === 'input' ? error : null,
        },
        access: workspace.isSandbox
          ? null
          : {
              status: asked?.status ?? 'NONE',
              requestedAt: asked?.requestedAt ?? null,
              decidedAt: asked?.decidedAt ?? null,
              sandboxSlug: asked?.sandboxSlug ?? null,
              refusalCode: asked?.refusalCode ?? null,
              canAsk: actor.can('developers.manage'),
              refusalAr:
                error === 'asked'
                  ? 'لم يُسجَّل طلب جديد: هناك طلب قائم بالفعل، أو لمساحة عملك مساحة اختبار.'
                  : null,
            },
      };
    },
  );

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs
        tabs={visible(SETTINGS_TABS, actor.capabilities)}
        current="/settings/developers"
        label="أقسام الإعدادات"
      />
      <SectionTabs
        tabs={visible(DEVELOPER_TABS, actor.capabilities)}
        current="/settings/developers/sandbox"
        label="أقسام مفاتيح الربط"
      />
      {/*
        Above the reference material, because somebody who has no sandbox cannot use any of
        what follows it and the screen used to send them to a support page to say so.
      */}
      {access ? <SandboxAccess view={access} requestAction={requestSandboxAction} /> : null}
      <Developer view={view} runAction={runPlaygroundAction} />
    </div>
  );
}
