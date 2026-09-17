import type { ReactElement } from 'react';
import { listKeyVersions, operatorCan } from '@nx-verify/core';
import { OperatorKeys, type KeyVersionView } from '../../../../../components/operator-keys';
import { operatorOrSignIn, operatorQuery } from '../../../../../lib/operator';
import { SectionTabs } from '../../../../../components/section-tabs';
import { INTEGRATION_TABS } from '../../../../../components/operator-nav';
import { activateVersionAction, retireVersionAction } from './actions';

/** Never prerendered, and refuses to render without an operator token. */
export const dynamic = 'force-dynamic';

export default async function OperatorKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string }>;
}): Promise<ReactElement> {
  const identity = await operatorOrSignIn();
  const { outcome } = await searchParams;
  const canEdit = operatorCan(identity.role, 'integration');

  const versions = await operatorQuery((db) => listKeyVersions(db));

  const view: KeyVersionView[] = versions.map((row) => ({
    version: row.version,
    status: row.status,
    activatedAt: row.activatedAt,
    retiredAt: row.retiredAt,
    notes: row.notes,
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs
        tabs={INTEGRATION_TABS}
        current="/operator/verification/keys"
        label="أقسام التحقق"
      />
      <OperatorKeys
        versions={view}
        outcome={outcome}
        canEdit={canEdit}
        activateAction={activateVersionAction}
        retireAction={retireVersionAction}
      />
    </div>
  );
}
