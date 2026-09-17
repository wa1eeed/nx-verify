import type { ReactElement } from 'react';
import { listInboundEvents } from '@nx-verify/core';
import {
  OperatorCallbacks,
  type CallbackRowView,
} from '../../../../../components/operator-callbacks';
import { operatorOrSignIn, operatorQuery } from '../../../../../lib/operator';
import { SectionTabs } from '../../../../../components/section-tabs';
import { INTEGRATION_TABS } from '../../../../../components/operator-nav';

/** Never prerendered, and refuses to render without an operator token. */
export const dynamic = 'force-dynamic';

export default async function OperatorCallbacksPage(): Promise<ReactElement> {
  await operatorOrSignIn();

  const rows = await operatorQuery((db) => listInboundEvents(db, 100));

  const view: CallbackRowView[] = rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    environment: row.environment,
    eventType: row.eventType,
    externalId: row.externalId,
    status: row.status,
    receivedAt: row.receivedAt,
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs
        tabs={INTEGRATION_TABS}
        current="/operator/verification/callbacks"
        label="أقسام التحقق"
      />
      <OperatorCallbacks rows={view} />
    </div>
  );
}
