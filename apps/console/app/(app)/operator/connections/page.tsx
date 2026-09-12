import type { ReactElement } from 'react';
import { listCatalog } from '@nx-verify/core';
import { listProviderConnections, secretStoreFromEnv } from '@nx-verify/providers';
import {
  OperatorConnections,
  type ConnectionView,
  type ConnectionsView,
} from '../../../../components/operator-connections';
import { operatorQuery, requireOperator } from '../../../../lib/operator';
import { setConnectionAction, setSecretAction } from './actions';

/** Never prerendered, and refuses to render without an operator token. */
export const dynamic = 'force-dynamic';

export default async function OperatorConnectionsPage(): Promise<ReactElement> {
  await requireOperator();

  const data = await operatorQuery(async (db) => ({
    catalog: await listCatalog(db),
    connections: await listProviderConnections(db),
  }));

  const store = secretStoreFromEnv();
  // Whether a secret can be written from here at all, asked of the store rather than
  // assumed: the answer differs between a deployment reading its environment and one
  // wired to a secret manager.
  const secretsWritable = typeof store.put === 'function';

  const view: ConnectionsView = {
    providers: data.catalog.map((entry) => entry.code),
    connections: data.connections.map(
      (connection): ConnectionView => ({
        provider: connection.provider,
        environment: connection.environment,
        kind: connection.kind,
        baseUrl: connection.baseUrl,
        authUrl: connection.authUrl,
        credentialRef: connection.credentialRef,
        timeoutMs: connection.timeoutMs,
        status: connection.status,
        // Whether a secret exists is a yes or no. The material is never read to answer it.
        hasSecret: connection.credentialRef !== null,
        updatedAt: connection.updatedAt,
      }),
    ),
    secretsWritable,
    secretsVariable: secretsWritable ? null : 'NX_SECRETS',
  };

  return (
    <OperatorConnections
      view={view}
      setConnectionAction={setConnectionAction}
      setSecretAction={setSecretAction}
    />
  );
}
