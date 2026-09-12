import type { Queryable } from '@nx-verify/db';
import type { ProviderRegistry } from './registry.js';
import { createProviderRegistry, providerConfigFromEnv, type ProviderConfig } from './factory.js';

/**
 * Which provider is running, read from the panel rather than from a deployment.
 *
 * A provider's address changes on a supplier's timetable, not ours: a sandbox host moves,
 * a second provider goes live, a base url is corrected an hour before a demonstration.
 * None of those should need a release, so the connection lives in a table an operator
 * edits and this builds the registry from it.
 *
 * Two rows per provider, one per environment. A sandbox host and a production host are
 * different addresses with different credentials, and a platform that cannot tell them
 * apart will one day check a real company against a test service.
 *
 * The credential is not here. The row carries a kms:// reference and the material lives in
 * the secret store (rule 10). See ADR-093.
 */

export interface ProviderConnection {
  provider: string;
  environment: 'sandbox' | 'live';
  kind: 'stub' | 'http' | 'openbanking';
  baseUrl: string | null;
  authUrl: string | null;
  credentialRef: string | null;
  timeoutMs: number;
  maxAttempts: number;
  status: 'active' | 'disabled';
  updatedAt: Date;
}

export async function listProviderConnections(db: Queryable): Promise<ProviderConnection[]> {
  const { rows } = await db.query<{
    provider: string;
    environment: 'sandbox' | 'live';
    kind: 'stub' | 'http' | 'openbanking';
    base_url: string | null;
    auth_url: string | null;
    credential_ref: string | null;
    timeout_ms: number;
    max_attempts: number;
    status: 'active' | 'disabled';
    updated_at: Date;
  }>(
    `SELECT provider, environment, kind, base_url, auth_url, credential_ref, timeout_ms,
            max_attempts, status, updated_at
     FROM provider_connections
     ORDER BY provider, environment`,
  );

  return rows.map((row) => ({
    provider: row.provider,
    environment: row.environment,
    kind: row.kind,
    baseUrl: row.base_url,
    authUrl: row.auth_url,
    credentialRef: row.credential_ref,
    timeoutMs: row.timeout_ms,
    maxAttempts: row.max_attempts,
    status: row.status,
    updatedAt: row.updated_at,
  }));
}

export interface SetConnectionInput {
  provider: string;
  environment: 'sandbox' | 'live';
  kind: 'stub' | 'http' | 'openbanking';
  baseUrl?: string | null;
  authUrl?: string | null;
  credentialRef?: string | null;
  timeoutMs?: number;
  maxAttempts?: number;
  status?: 'active' | 'disabled';
}

export async function setProviderConnection(
  operator: Queryable,
  input: SetConnectionInput,
  operatorId: string,
): Promise<void> {
  await operator.query(
    `INSERT INTO provider_connections (provider, environment, kind, base_url, auth_url,
                                       credential_ref, timeout_ms, max_attempts, status,
                                       updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (provider, environment) DO UPDATE SET
       kind = EXCLUDED.kind,
       base_url = EXCLUDED.base_url,
       auth_url = EXCLUDED.auth_url,
       credential_ref = EXCLUDED.credential_ref,
       timeout_ms = EXCLUDED.timeout_ms,
       max_attempts = EXCLUDED.max_attempts,
       status = EXCLUDED.status,
       updated_at = now()`,
    [
      input.provider,
      input.environment,
      input.kind,
      input.baseUrl ?? null,
      input.authUrl ?? null,
      input.credentialRef ?? null,
      input.timeoutMs ?? 20_000,
      input.maxAttempts ?? 3,
      input.status ?? 'active',
    ],
  );

  // Recorded against no subscriber: this is our own configuration, and the audit entry
  // names the address and never a credential.
  await operator.query(
    `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target, metadata)
     SELECT t.id, 'NX_STAFF', $1, 'provider.connection_set', $2, $3::jsonb
     FROM tenants t
     JOIN tenant_provider_binding b ON b.tenant_id = t.id AND b.provider = $2
     LIMIT 50`,
    [
      operatorId,
      input.provider,
      JSON.stringify({
        environment: input.environment,
        kind: input.kind,
        base_url: input.baseUrl ?? null,
        credential_ref: input.credentialRef ?? null,
      }),
    ],
  );
}

/**
 * Builds the registry for one environment.
 *
 * Falls back to the environment variables when the table has nothing for that
 * environment, so a deployment that has not used the panel yet keeps working exactly as
 * it did. A row wins over the variable, because somebody changed it on purpose.
 */
export async function registryFor(
  db: Queryable,
  environment: 'sandbox' | 'live',
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ProviderRegistry> {
  const connections = (await listProviderConnections(db)).filter(
    (connection) => connection.environment === environment && connection.status === 'active',
  );

  if (connections.length === 0) {
    return createProviderRegistry(providerConfigFromEnv(env));
  }

  const configs = connections.map((connection): ProviderConfig => ({
    name: connection.provider,
    kind: connection.kind,
    ...(connection.baseUrl === null ? {} : { baseUrl: connection.baseUrl }),
    ...(connection.authUrl === null ? {} : { authUrl: connection.authUrl }),
    timeoutMs: connection.timeoutMs,
    maxAttempts: connection.maxAttempts,
  }));

  return createProviderRegistry(configs);
}
