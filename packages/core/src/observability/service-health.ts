import type { Queryable } from '@nx-verify/db';
import { isLowOnCredit, operationsLeft } from '../billing/capacity.js';

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
  /**
   * Operations left on a plan or a bundle, or null for a workspace running on riyals alone.
   *
   * Here because the riyal balance beside it does not answer «is this subscriber about to
   * stop»: a workspace on a bundle spends no riyals at all (ADR-162).
   */
  operationsLeft: number | null;
  /** True when what they hold is low enough to stop work soon: operations or riyals. */
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
    plan_left: string | null;
    bundle_operations: string;
    operations_bought: string;
    unhealthy: string[] | null;
  }>(
    `SELECT t.id AS tenant_id, t.legal_name, t.slug, t.sandbox_of,
            coalesce(r.calls, 0)::text AS calls,
            coalesce(r.failures, 0)::text AS failures,
            r.slowest_ms::text,
            w.balance::text,
            w.held::text,
            w.low_threshold::text AS low_threshold,
            c.plan_left::text AS plan_left,
            coalesce(g.operations, 0)::text AS bundle_operations,
            (coalesce(c.plan_bought, 0) + coalesce(g.granted, 0))::text AS operations_bought,
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
     -- What a plan and a bundle still cover, in operations. A subscriber spending these
     -- spends no riyals, so the wallet alone says nothing about whether work will stop.
     LEFT JOIN LATERAL (
       SELECT CASE
                WHEN s.included_transactions IS NULL THEN NULL
                ELSE greatest(0, s.included_transactions - s.transactions_used)
              END AS plan_left,
              coalesce(s.included_transactions, 0) AS plan_bought
       FROM tenant_commitments s
       WHERE s.tenant_id = t.id AND s.status = 'active'
       LIMIT 1
     ) c ON true
     LEFT JOIN LATERAL (
       SELECT sum(b.operations - b.used) AS operations, sum(b.operations) AS granted
       FROM bundle_grants b
       WHERE b.tenant_id = t.id AND b.used < b.operations AND b.expires_at > now()
     ) g ON true
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
    const lowThreshold = Number(row.low_threshold ?? '0');
    // The one predicate every screen asks, so support and the subscriber never disagree about
    // whether work is about to stop (ADR-162).
    const capacity = {
      planLeft: row.plan_left === null ? null : Number(row.plan_left),
      bundleOperations: Number(row.bundle_operations),
      operationsBought: Number(row.operations_bought),
      walletAvailableHalalas: balance - held,
      walletIsLow: balance > 0 && balance - held <= balance * lowThreshold,
    };
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
      operationsLeft: operationsLeft(capacity),
      balanceLow: isLowOnCredit(capacity),
      unhealthyProviders: row.unhealthy ?? [],
    };
  });
}
