import type { ReactElement } from 'react';
import { listApiKeys } from '@nx-verify/core';
import { ApiKeys, type ApiKeyView } from '../../../../components/api-keys';
import { query } from '../../../../lib/context';
import { issueKeyAction, revokeKeyAction } from './actions';

/** Never prerendered: one workspace's credentials, read at request time. */
export const dynamic = 'force-dynamic';

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const issued = params['issued'];

  const keys = await query(async (tx) =>
    (await listApiKeys(tx)).map(
      (key): ApiKeyView => ({
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: key.scopes,
        environment: key.environment,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
      }),
    ),
  );

  return (
    <ApiKeys
      keys={keys}
      issuedSecret={typeof issued === 'string' ? issued : null}
      issueAction={issueKeyAction}
      revokeAction={revokeKeyAction}
    />
  );
}
