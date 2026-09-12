import type { TenantTransaction } from '@nx-verify/db';

/**
 * What a customer's engineer sees when an integration misbehaves.
 *
 * The audit log records acts: a verification was created, a key was revoked. This records
 * calls: a request arrived, was refused for a missing scope, and took nine milliseconds to
 * say so. The two answer different questions and the second one is the one asked first.
 *
 * What is recorded is deliberately thin. The route rather than the address, because a path
 * carries values and values are what rule 4 keeps out of logs. Our error code rather than
 * a message, because messages change. And never the body, because the body is the subject.
 */

export interface ApiRequestRecord {
  apiKeyId: string | null;
  requestId: string;
  method: string;
  /** The route pattern, such as /v1/verifications/:id. Never the address called. */
  route: string;
  status: number;
  latencyMs: number;
  errorCode?: string | null;
  environment: 'sandbox' | 'live';
}

export async function recordApiRequest(
  tx: TenantTransaction,
  record: ApiRequestRecord,
): Promise<void> {
  await tx.query(
    `INSERT INTO api_requests (tenant_id, api_key_id, request_id, method, route, status,
                               latency_ms, error_code, environment)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      tx.tenantId,
      record.apiKeyId,
      record.requestId,
      record.method,
      record.route,
      record.status,
      Math.max(0, Math.round(record.latencyMs)),
      record.errorCode ?? null,
      record.environment,
    ],
  );
}

export interface ApiRequestRow {
  id: string;
  requestId: string;
  method: string;
  route: string;
  status: number;
  latencyMs: number;
  errorCode: string | null;
  environment: string;
  at: Date;
}

export interface ApiLogFilter {
  limit?: number;
  /** Only the calls that failed, which is what somebody debugging came for. */
  failuresOnly?: boolean;
  environment?: 'sandbox' | 'live';
}

export async function listApiRequests(
  tx: TenantTransaction,
  filter: ApiLogFilter = {},
): Promise<ApiRequestRow[]> {
  const { rows } = await tx.query<{
    id: string;
    request_id: string;
    method: string;
    route: string;
    status: number;
    latency_ms: number;
    error_code: string | null;
    environment: string;
    created_at: Date;
  }>(
    `SELECT id::text, request_id, method, route, status, latency_ms, error_code,
            environment, created_at
     FROM api_requests
     WHERE tenant_id = $1
       AND ($2::boolean IS NOT TRUE OR status >= 400)
       AND ($3::text IS NULL OR environment = $3)
     ORDER BY id DESC
     LIMIT $4`,
    [tx.tenantId, filter.failuresOnly ?? false, filter.environment ?? null, filter.limit ?? 100],
  );

  return rows.map((row) => ({
    id: row.id,
    requestId: row.request_id,
    method: row.method,
    route: row.route,
    status: row.status,
    latencyMs: row.latency_ms,
    errorCode: row.error_code,
    environment: row.environment,
    at: row.created_at,
  }));
}

/**
 * Clears old calls.
 *
 * The fastest growing table in a platform like this, and the least valuable after a month.
 * Kept separate from the retention policy for attestations, which answers a legal question
 * rather than an operational one.
 */
export async function pruneApiRequests(
  tx: TenantTransaction,
  olderThanDays = 30,
): Promise<number> {
  const { rowCount } = await tx.query(
    `DELETE FROM api_requests
     WHERE tenant_id = $1 AND created_at < now() - make_interval(days => $2)`,
    [tx.tenantId, olderThanDays],
  );
  return rowCount ?? 0;
}
