import type { Queryable } from '@nx-verify/db';

/**
 * The three questions support is asked by telephone.
 *
 * Are our calls failing, is our balance about to stop us, and is the provider behind our
 * checks healthy. Each is answered here across subscribers, on the operator connection,
 * from tables that say what a customer bought or what our own service did, and never from
 * one that says what a customer knows. See ADR-087.
 */

export interface SubscriberHealthRow {
  tenantId: string;
  legalName: string;
  slug: string;
  isSandbox: boolean;
  /** Calls in the window, and how many of them failed. */
  calls: number;
  failures: number;
  /** The slowest call in the window, in milliseconds. */
  slowestMs: number;
  balanceHalalas: number;
  heldHalalas: number;
  /** True when the balance is low enough to stop work soon. */
  balanceLow: boolean;
  /** Providers bound to this subscriber that are not healthy right now. */
  unhealthyProviders: string[];
}

export async function subscriberHealth(
  operator: Queryable,
  options: { windowHours?: number } = {},
): Promise<SubscriberHealthRow[]> {
  const windowHours = options.windowHours ?? 24;

  const { rows } = await operator.query<{
    tenant_id: string;
    legal_name: string;
    slug: string;
    sandbox_of: string | null;
    calls: string;
    failures: string;
    slowest_ms: string | null;
    balance: string | null;
    held: string | null;
    low_threshold: string | null;
    unhealthy: string[] | null;
  }>(
    `SELECT t.id AS tenant_id, t.legal_name, t.slug, t.sandbox_of,
            coalesce(r.calls, 0)::text AS calls,
            coalesce(r.failures, 0)::text AS failures,
            r.slowest_ms::text,
            w.balance::text,
            w.held::text,
            w.low_threshold::text AS low_threshold,
            p.unhealthy
     FROM tenants t
     LEFT JOIN LATERAL (
       SELECT count(*) AS calls,
              count(*) FILTER (WHERE status >= 400) AS failures,
              max(latency_ms) AS slowest_ms
       FROM api_requests a
       WHERE a.tenant_id = t.id AND a.created_at > now() - make_interval(hours => $1)
     ) r ON true
     LEFT JOIN wallets w ON w.tenant_id = t.id
     LEFT JOIN LATERAL (
       SELECT array_agg(b.provider ORDER BY b.provider) AS unhealthy
       FROM tenant_provider_binding b
       WHERE b.tenant_id = t.id AND b.health_status <> 'healthy'
     ) p ON true
     WHERE t.status = 'active'
     ORDER BY coalesce(r.failures, 0) DESC, t.legal_name`,
    [windowHours],
  );

  return rows.map((row) => {
    const balance = Number(row.balance ?? '0');
    const held = Number(row.held ?? '0');
    // The same rule the subscriber's own wallet uses, so a screen here and a screen there
    // never disagree about whether a balance is low.
    const lowThreshold = Number(row.low_threshold ?? '0');
    return {
      tenantId: row.tenant_id,
      legalName: row.legal_name,
      slug: row.slug,
      isSandbox: row.sandbox_of !== null,
      calls: Number(row.calls),
      failures: Number(row.failures),
      slowestMs: Number(row.slowest_ms ?? '0'),
      balanceHalalas: balance,
      heldHalalas: held,
      balanceLow: balance > 0 && balance - held <= balance * lowThreshold,
      unhealthyProviders: row.unhealthy ?? [],
    };
  });
}
