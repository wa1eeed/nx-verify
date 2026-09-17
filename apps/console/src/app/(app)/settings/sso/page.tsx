import type { ReactElement } from 'react';
import { getIdp, listSsoDomains } from '@nx-verify/core';
import { SsoSettings, type IdpView, type SsoDomainView } from '../../../../components/sso-settings';
import { query } from '../../../../lib/context';
import { SectionTabs } from '../../../../components/section-tabs';
import { SETTINGS_TABS } from '../../../../components/nav';
import {
  claimDomainAction,
  configureIdpAction,
  removeDomainAction,
  verifyDomainAction,
} from './actions';

/** Never prerendered: one workspace's directory configuration. */
export const dynamic = 'force-dynamic';

export default async function SsoPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string }>;
}): Promise<ReactElement> {
  const { outcome } = await searchParams;

  const data = await query(async (tx) => ({
    idp: await getIdp(tx),
    domains: await listSsoDomains(tx),
  }));

  const idp: IdpView | null =
    data.idp === null
      ? null
      : {
          issuer: data.idp.issuer,
          clientId: data.idp.clientId,
          hasSecret: data.idp.hasSecret,
          discoveryUrl: data.idp.discoveryUrl,
          defaultRole: data.idp.defaultRole,
          allowJit: data.idp.allowJit,
          enforceSso: data.idp.enforceSso,
        };

  const domains: SsoDomainView[] = data.domains.map((row) => ({
    domain: row.domain,
    verified: row.verified,
    proofToken: row.proofToken,
    checkedAt: row.checkedAt,
    lastError: row.lastError,
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={SETTINGS_TABS} current="/settings/sso" label="أقسام الإعدادات" />
      <SsoSettings
        idp={idp}
        domains={domains}
        outcome={outcome}
        configureAction={configureIdpAction}
        claimAction={claimDomainAction}
        verifyAction={verifyDomainAction}
        removeAction={removeDomainAction}
      />
    </div>
  );
}
