import type { ReactElement } from 'react';
import { PRIMARY_CONNECTION_DEFAULTS, PRIMARY_PROVIDER } from '@nx-verify/db';
import {
  listOperatorChanges,
  listProviderConnections,
  secretStoreFromEnv,
} from '@nx-verify/providers';
import {
  OperatorIntegration,
  type IntegrationEnvironment,
  type IntegrationView,
} from '../../../../../components/operator-integration';
import { SectionTabs } from '../../../../../components/section-tabs';
import { INTEGRATION_TABS } from '../../../../../components/operator-shell';
import { operatorQuery, requireOperator } from '../../../../../lib/operator';
import { rotateCallbackAction, saveIntegrationAction, testIntegrationAction } from './actions';

/** Never prerendered, and refuses to render without an operator sign in. */
export const dynamic = 'force-dynamic';

const ERRORS = new Set(['url', 'readonly', 'missing', 'unconfigured']);

export default async function OperatorIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  await requireOperator();
  const params = await searchParams;
  const environment: IntegrationEnvironment = params['env'] === 'live' ? 'live' : 'sandbox';
  const target = `${PRIMARY_PROVIDER}/${environment}`;

  const data = await operatorQuery(async (db) => ({
    connection: (await listProviderConnections(db)).find(
      (row) => row.provider === PRIMARY_PROVIDER && row.environment === environment,
    ),
    changes: await listOperatorChanges(db, target, 10),
  }));

  const store = secretStoreFromEnv();
  const ref =
    data.connection?.credentialRef ?? `kms://providers/${PRIMARY_PROVIDER}/${environment}`;
  // Described, never fetched for display: the screen learns which fields are set and a
  // fingerprint of each, and no value reaches the page.
  const credential = store.describe ? await store.describe(ref).catch(() => null) : null;
  const webhookRef = data.connection?.callbackSecretRef ?? `${ref}/webhook`;
  const webhook = store.describe ? await store.describe(webhookRef).catch(() => null) : null;

  const publicBaseUrl = process.env['NX_PUBLIC_BASE_URL'] ?? 'http://localhost:3000';
  const defaults = PRIMARY_CONNECTION_DEFAULTS[environment];
  const errorParam = typeof params['error'] === 'string' ? params['error'] : null;

  const view: IntegrationView = {
    environment,
    baseUrl: data.connection?.baseUrl ?? defaults.baseUrl,
    authUrl: data.connection?.authUrl ?? defaults.authUrl,
    credential,
    webhook,
    callbackUrl: data.connection?.callbackSlug
      ? `${publicBaseUrl}/v1/callbacks/${data.connection.callbackSlug}`
      : null,
    callbackHeader: data.connection?.callbackHeader ?? 'x-nx-provider-signature',
    callbackAlgorithm: data.connection?.callbackAlgorithm ?? 'sha256',
    lastTest:
      data.connection?.lastTestAt && data.connection.lastTestOk !== null
        ? {
            at: data.connection.lastTestAt,
            ok: data.connection.lastTestOk,
            detail: data.connection.lastTestDetail ?? '',
          }
        : null,
    changes: data.changes.map((change) => ({
      at: change.at,
      operatorId: change.operatorId,
      action: change.action,
      fields: Array.isArray(change.metadata['fields'])
        ? (change.metadata['fields'] as string[])
        : [],
    })),
    secretsWritable: store.writable,
    notice:
      params['saved'] !== undefined ? 'saved' : params['tested'] !== undefined ? 'tested' : null,
    error:
      errorParam !== null && ERRORS.has(errorParam)
        ? (errorParam as IntegrationView['error'])
        : null,
  };

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs
        tabs={INTEGRATION_TABS}
        current="/operator/verification/integration"
        label="أقسام إعدادات التحقق"
      />
      <OperatorIntegration
        view={view}
        saveAction={saveIntegrationAction}
        testAction={testIntegrationAction}
        callbackAction={rotateCallbackAction}
      />
    </div>
  );
}
