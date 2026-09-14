import type { TenantTransaction } from '@nx-verify/db';
import { readPage, type Page, type PageRequest } from '../pagination.js';

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
  offset?: number;
  /** Only the calls that failed, which is what somebody debugging came for. */
  failuresOnly?: boolean;
  environment?: 'sandbox' | 'live';
}

// The tenant is constrained in each statement itself, where rule 2's scan can see it.
const API_LOG_FILTER = `($2::boolean IS NOT TRUE OR status >= 400)
       AND ($3::text IS NULL OR environment = $3)`;

function apiLogFilterValues(tx: TenantTransaction, filter: ApiLogFilter): unknown[] {
  return [tx.tenantId, filter.failuresOnly ?? false, filter.environment ?? null];
}

/** How many calls the filters leave, for the pages of the log. */
export async function countApiRequests(
  tx: TenantTransaction,
  filter: ApiLogFilter = {},
): Promise<number> {
  const { rows } = await tx.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM api_requests WHERE tenant_id = $1 AND ${API_LOG_FILTER}`,
    apiLogFilterValues(tx, filter),
  );
  return Number(rows[0]?.count ?? 0);
}

export interface ApiLogTallies {
  total: number;
  failures: number;
  slowestMs: number;
}

/** The figures above the log, over every call the filters leave rather than the page on screen. */
export async function apiLogTallies(
  tx: TenantTransaction,
  filter: ApiLogFilter = {},
): Promise<ApiLogTallies> {
  const { rows } = await tx.query<{ total: string; failures: string; slowest: number | null }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE status >= 400)::text AS failures,
            max(latency_ms) AS slowest
     FROM api_requests WHERE tenant_id = $1 AND ${API_LOG_FILTER}`,
    apiLogFilterValues(tx, filter),
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    failures: Number(rows[0]?.failures ?? 0),
    slowestMs: rows[0]?.slowest ?? 0,
  };
}

/** One page of the log, newest first. */
export async function pageApiRequests(
  tx: TenantTransaction,
  filter: Omit<ApiLogFilter, 'limit' | 'offset'>,
  request: PageRequest,
): Promise<Page<ApiRequestRow>> {
  return readPage(
    request,
    () => countApiRequests(tx, filter),
    (window) => listApiRequests(tx, { ...filter, ...window }),
  );
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
     WHERE tenant_id = $1 AND ${API_LOG_FILTER}
     -- Qualified: the select list names id::text as id, and a bare ORDER BY id would sort
     -- that text, which puts request 9 after request 29.
     ORDER BY api_requests.id DESC
     LIMIT $4 OFFSET $5`,
    [...apiLogFilterValues(tx, filter), filter.limit ?? 100, Math.max(filter.offset ?? 0, 0)],
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
export async function pruneApiRequests(tx: TenantTransaction, olderThanDays = 30): Promise<number> {
  const { rowCount } = await tx.query(
    `DELETE FROM api_requests
     WHERE tenant_id = $1 AND created_at < now() - make_interval(days => $2)`,
    [tx.tenantId, olderThanDays],
  );
  return rowCount ?? 0;
}
