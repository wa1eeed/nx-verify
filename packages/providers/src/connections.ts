import type { Queryable } from '@nx-verify/db';
import type { ProviderRegistry } from './registry.js';
import { createProviderRegistry, providerConfigFromEnv, type ProviderConfig } from './factory.js';
import { httpMappingsFor, listProviderEndpoints, openBankingMappingsFor } from './endpoint-map.js';

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
  /** The opaque path a provider calls back on, once one has been issued. */
  callbackSlug: string | null;
  callbackSecretRef: string | null;
  callbackHeader: string;
  callbackAlgorithm: 'sha256' | 'sha512';
  updatedAt: Date;
  /** The last connection test from the panel, when there has been one. */
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  lastTestDetail: string | null;
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
    callback_slug: string | null;
    callback_secret_ref: string | null;
    callback_header: string;
    callback_algorithm: 'sha256' | 'sha512';
    updated_at: Date;
    last_test_at: Date | null;
    last_test_ok: boolean | null;
    last_test_detail: string | null;
  }>(
    `SELECT provider, environment, kind, base_url, auth_url, credential_ref, timeout_ms,
            max_attempts, status, callback_slug, callback_secret_ref, callback_header,
            callback_algorithm, updated_at, last_test_at, last_test_ok, last_test_detail
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
    callbackSlug: row.callback_slug,
    callbackSecretRef: row.callback_secret_ref,
    callbackHeader: row.callback_header,
    callbackAlgorithm: row.callback_algorithm,
    updatedAt: row.updated_at,
    lastTestAt: row.last_test_at,
    lastTestOk: row.last_test_ok,
    lastTestDetail: row.last_test_detail,
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

  // Recorded against no subscriber: this is our own configuration, so it goes to the
  // panel's own trail rather than into every subscriber's (0044). The entry names the
  // address and the reference, never a credential.
  await recordOperatorChange(operator, {
    operatorId,
    action: 'connection.set',
    target: `${input.provider}/${input.environment}`,
    metadata: {
      kind: input.kind,
      base_url: input.baseUrl ?? null,
      auth_url: input.authUrl ?? null,
      credential_ref: input.credentialRef ?? null,
    },
  });
}

export interface OperatorChange {
  operatorId: string;
  action: string;
  target: string;
  /** References and field names only. Never material. */
  metadata?: Record<string, unknown>;
}

export async function recordOperatorChange(operator: Queryable, change: OperatorChange): Promise<void> {
  await operator.query(
    `INSERT INTO operator_audit (operator_id, action, target, metadata) VALUES ($1, $2, $3, $4::jsonb)`,
    [change.operatorId, change.action, change.target, JSON.stringify(change.metadata ?? {})],
  );
}

export interface OperatorChangeRow extends Required<OperatorChange> {
  at: Date;
}

export async function listOperatorChanges(
  operator: Queryable,
  target: string,
  limit = 10,
): Promise<OperatorChangeRow[]> {
  const { rows } = await operator.query<{
    at: Date;
    operator_id: string;
    action: string;
    target: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT at, operator_id, action, target, metadata FROM operator_audit
     WHERE target = $1 ORDER BY at DESC LIMIT $2`,
    [target, limit],
  );
  return rows.map((row) => ({
    at: row.at,
    operatorId: row.operator_id,
    action: row.action,
    target: row.target,
    metadata: row.metadata,
  }));
}

export interface ConnectionTestResult {
  ok: boolean;
  /** A status line: "200", "401", "timeout". Never a body. */
  detail: string;
}

export async function recordConnectionTest(
  operator: Queryable,
  input: { provider: string; environment: 'sandbox' | 'live' } & ConnectionTestResult,
): Promise<void> {
  await operator.query(
    `UPDATE provider_connections
     SET last_test_at = now(), last_test_ok = $3, last_test_detail = $4
     WHERE provider = $1 AND environment = $2`,
    [input.provider, input.environment, input.ok, input.detail.slice(0, 200)],
  );
}

/**
 * Asks the identity service for a token with the stored credential, and nothing else.
 *
 * The cheapest question that proves the credential: it costs no verification, touches no
 * subscriber, and a wrong paste answers 401 in under a second. The body of the answer is
 * never read beyond whether it holds a token, because an identity service that echoes the
 * client id back would otherwise put it on a screen.
 */
export async function testClientCredentials(
  input: { authUrl: string; clientId: string; clientSecret: string; scope?: string },
  fetcher: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
  timeoutMs = 10_000,
): Promise<ConnectionTestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(input.authUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: input.clientId,
        client_secret: input.clientSecret,
        scope: input.scope ?? 'api',
      }).toString(),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, detail: String(response.status) };
    }
    const body = (await response.json().catch(() => ({}))) as { access_token?: unknown };
    return typeof body.access_token === 'string'
      ? { ok: true, detail: String(response.status) }
      : { ok: false, detail: 'no token in the answer' };
  } catch (error) {
    return {
      ok: false,
      detail: (error as Error).name === 'AbortError' ? 'timeout' : 'unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
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

  // The endpoint map for this environment, where one has been entered. A row wins over
  // the map compiled into the adapter, because somebody entered it on purpose.
  const stored = await listProviderEndpoints(db, environment);

  const configs = connections.map((connection): ProviderConfig => {
    const endpoints =
      connection.kind === 'openbanking'
        ? openBankingMappingsFor(stored, connection.provider)
        : httpMappingsFor(stored, connection.provider);

    return {
      name: connection.provider,
      kind: connection.kind,
      ...(connection.baseUrl === null ? {} : { baseUrl: connection.baseUrl }),
      ...(connection.authUrl === null ? {} : { authUrl: connection.authUrl }),
      timeoutMs: connection.timeoutMs,
      maxAttempts: connection.maxAttempts,
      ...(endpoints === null ? {} : { endpoints }),
    };
  });

  return createProviderRegistry(configs);
}
