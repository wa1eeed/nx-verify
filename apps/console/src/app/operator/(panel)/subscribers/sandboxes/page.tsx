import type { ReactElement } from 'react';
import { listPendingSandboxRequests } from '@nx-verify/core';
import { PageHeader } from '../../../../../components/page-header';
import { CardNote } from '../../../../../components/ui/card';
import { Notice } from '../../../../../components/ui/notice';
import {
  PendingSandboxes,
  type PendingSandboxView,
} from '../../../../../components/sandbox-access';
import { operatorOrSignIn, operatorQuery } from '../../../../../lib/operator';
import { answerSandboxAction } from './actions';
import { SectionTabs } from '../../../../../components/section-tabs';
import { SUBSCRIBER_TABS, subscriberTabCounts } from '../../../../../components/operator-shell';

/** Never prerendered, and refuses to render without an operator token. */
export const dynamic = 'force-dynamic';

export default async function OperatorSandboxesPage(): Promise<ReactElement> {
  await operatorOrSignIn();

  const pending = await operatorQuery((db) => listPendingSandboxRequests(db));

  /*
   * Whether a sandbox workspace would be able to run anything once it exists.
   *
   * A sandbox carries no binding of its own on purpose: the credential is resolved from the
   * platform's own connection for the environment the workspace lives in, which is what keeps
   * a sandbox off the production credential. The other side of that is that without a sandbox
   * connection configured, a workspace made here is a workspace where every call fails. The
   * count is a count: no provider is named, here or anywhere a subscriber can reach.
   */
  const { rows: connections } = await operatorQuery((db) =>
    db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM provider_connections
       WHERE environment = 'sandbox' AND status = 'active' AND credential_ref IS NOT NULL`,
    ),
  );
  const canRun = Number(connections[0]?.count ?? '0') > 0;

  const view: PendingSandboxView[] = pending.map((request) => ({
    id: request.id,
    tenantName: request.tenantName,
    tenantSlug: request.tenantSlug,
    requestedAt: request.requestedAt,
    alreadyHasSandbox: request.alreadyHasSandbox,
  }));

  return (
    <div className="stack" style={{ gap: 'var(--space-6)' }}>
      {/*
        The number the sidebar and the other tabs of this section carry, on the tab that
        answers it. Measured from the list this screen already read rather than counted again:
        what rule 2 refuses is a figure drawn from rows nobody was going to show, and these
        rows are the screen (ADR-186).
      */}
      <SectionTabs
        tabs={SUBSCRIBER_TABS}
        current="/operator/subscribers/sandboxes"
        label="أقسام المشتركين"
        counts={subscriberTabCounts(pending.length)}
      />
      <PageHeader
        title="مساحات الاختبار"
        subtitle="طلبات مشتركين لمساحة اختبار، بانتظار قرار بإنشائها."
      />
      {/*
        Said here because it is the reason this screen exists rather than a button on the
        subscriber's own screen: the link between a workspace and its sandbox is written by the
        operator role alone, so that no workspace can declare itself, or its past work, a test.
      */}
      <CardNote role="sandbox-panel-note">
        الإنشاء من هنا يتم كاملاً بضغطة واحدة: مساحة عمل جديدة باسم المشترك، على باقة بيئة الاختبار،
        برصيد تجريبي، وحساب دخول لمن طلبها بكلمة مرور أولى تُعرض مرة واحدة. ما يحتاج قراراً منك هو
        أن تُنشأ أصلاً، لأن ربط مساحة بأخرى صلاحية المنصة وحدها.
      </CardNote>
      {canRun ? null : (
        <Notice tone="refused" role="sandbox-has-no-connection">
          لا يوجد في هذا النشر ربطٌ فعّال لبيئة الاختبار، فالمساحة التي تُنشأ الآن تُفتح ولا ينجح
          فيها نداء واحد. اضبطه من إعدادات التحقق قبل تسليم أي مساحة.
        </Notice>
      )}
      <PendingSandboxes pending={view} answerAction={answerSandboxAction} />
    </div>
  );
}
