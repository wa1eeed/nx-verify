import { withSavepoint, type Queryable, type TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { halalasToRiyals, riyalsToHalalas } from '../billing/money.js';

/**
 * Which provider serves a verification service, decided by the platform rather than written
 * into a product.
 *
 * The thing an owner actually decides is «from today, the national address check is served by
 * this provider», because that provider's price moved or its contract ended. Until this existed
 * the only way to say it was to edit the catalogue, and the margin the pricing screen showed was
 * computed against the provider a step declared rather than whoever would really take the call.
 *
 * Three levels, in this order, and the order is the decision:
 *
 *   1. the subscriber's own binding, because that is a contract with one customer
 *   2. the platform's routing for this service, which is what this file manages
 *   3. the provider the product step declares, kept as the last resort so a catalogue that
 *      still names one keeps working
 *
 * Rule 5 is untouched throughout: every name here reaches the operator panel and the code that
 * places the call, and nothing tenant facing.
 */

export type RoutingStatus = 'active' | 'standby';

export interface ServiceRoute {
  productCode: string;
  provider: string;
  priority: number;
  status: RoutingStatus;
  note: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

/** Everything routed for one service, most preferred first. */
export async function listServiceRoutes(
  db: Queryable,
  productCode?: string,
): Promise<ServiceRoute[]> {
  const { rows } = await db.query<{
    product_code: string;
    provider: string;
    priority: number;
    status: RoutingStatus;
    note: string | null;
    updated_at: Date;
    updated_by: string | null;
  }>(
    `SELECT product_code, provider, priority, status, note, updated_at, updated_by
     FROM product_provider_routing
     WHERE ($1::text IS NULL OR product_code = $1)
     ORDER BY product_code, priority, provider`,
    [productCode ?? null],
  );
  return rows.map((row) => ({
    productCode: row.product_code,
    provider: row.provider,
    priority: row.priority,
    status: row.status,
    note: row.note,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }));
}

export interface SetServiceRouteInput {
  productCode: string;
  provider: string;
  priority?: number;
  status?: RoutingStatus;
  note?: string | null;
  actorId: string;
}

/**
 * Put a provider on a service, or move it.
 *
 * Writing the trail is not optional here: which provider served a verification is the question
 * a subscriber's auditor asks a year later, and «we think it was changed in September» is not
 * an answer.
 */
export async function setServiceRoute(db: Queryable, input: SetServiceRouteInput): Promise<void> {
  const priority = input.priority ?? 100;
  if (!Number.isInteger(priority) || priority <= 0) {
    throw new NxError('NX-4001', { detail: 'priority must be a positive whole number' });
  }

  const { rows } = await db.query<{ before: string | null }>(
    `WITH previous AS (
       SELECT provider || ':' || priority::text || ':' || status AS before
       FROM product_provider_routing WHERE product_code = $1 AND provider = $2
     )
     INSERT INTO product_provider_routing
       (product_code, provider, priority, status, note, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, now(), $6)
     ON CONFLICT (product_code, provider) DO UPDATE SET
       priority = EXCLUDED.priority,
       status = EXCLUDED.status,
       note = EXCLUDED.note,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by
     RETURNING (SELECT before FROM previous)`,
    [
      input.productCode,
      input.provider,
      priority,
      input.status ?? 'active',
      input.note ?? null,
      input.actorId,
    ],
  );

  await recordRoutingChange(db, {
    action: 'routing.set',
    productCode: input.productCode,
    provider: input.provider,
    actorId: input.actorId,
    metadata: {
      priority,
      status: input.status ?? 'active',
      from: rows[0]?.before ?? null,
    },
  });
}

/** Take a provider off a service entirely. */
export async function removeServiceRoute(
  db: Queryable,
  input: { productCode: string; provider: string; actorId: string },
): Promise<void> {
  const { rowCount } = await db.query(
    `DELETE FROM product_provider_routing WHERE product_code = $1 AND provider = $2`,
    [input.productCode, input.provider],
  );
  if ((rowCount ?? 0) === 0) {
    throw new NxError('NX-4041', { detail: 'that provider is not routed to this service' });
  }
  await recordRoutingChange(db, {
    action: 'routing.removed',
    productCode: input.productCode,
    provider: input.provider,
    actorId: input.actorId,
    metadata: {},
  });
}

async function recordRoutingChange(
  db: Queryable,
  input: {
    action: string;
    productCode: string;
    provider: string;
    actorId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO operator_audit (operator_id, action, target, metadata)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [
      input.actorId,
      input.action,
      `routing:${input.productCode}`,
      JSON.stringify({ ...input.metadata, provider: input.provider }),
    ],
  );
}

export interface ProviderOffer {
  provider: string;
  nameAr: string;
  /** What one run of this service would cost us under this provider, in halalas. */
  costHalalas: number | null;
  /** Null when this provider has no price for one of the service's steps. */
  serves: boolean;
  routed: boolean;
  priority: number | null;
  status: RoutingStatus | null;
  health: string;
}

export interface ServiceRouting {
  productCode: string;
  nameAr: string;
  /** The provider that will take the next call, when nothing overrides it for a subscriber. */
  servedBy: string | null;
  priceHalalas: number | null;
  costHalalas: number | null;
  marginPct: number | null;
  offers: ProviderOffer[];
  /** What actually happened this month, per provider. Proof rather than a claim. */
  served: { provider: string; calls: number; failed: number; lastCallAt: Date | null }[];
}

function marginOf(priceHalalas: number | null, costHalalas: number | null): number | null {
  if (priceHalalas === null || priceHalalas <= 0 || costHalalas === null) {
    return null;
  }
  return Math.round(((priceHalalas - costHalalas) / priceHalalas) * 100);
}

/**
 * Every verification service, who serves it, what each provider would cost, and what our margin
 * would be under each.
 *
 * One query per part rather than one per service: an owner comparing providers is comparing a
 * table, and a table assembled a row at a time is a screen that takes a second to draw.
 */
export async function serviceRouting(db: Queryable): Promise<ServiceRouting[]> {
  const { rows: services } = await db.query<{
    code: string;
    name_ar: string;
    price: string | null;
  }>(
    `SELECT p.code, p.name_ar,
            (SELECT unit_price::text FROM price_book b
             WHERE b.product_code = p.code AND b.tenant_id IS NULL AND b.valid_to IS NULL
             ORDER BY b.valid_from DESC LIMIT 1) AS price
     FROM products p
     WHERE p.status <> 'retired'
     ORDER BY p.check_order, p.code`,
  );

  const { rows: offers } = await db.query<{
    product_code: string;
    provider: string;
    name_ar: string;
    cost: string | null;
    priority: number | null;
    status: RoutingStatus | null;
    health: string | null;
  }>(
    `SELECT p.code AS product_code, c.code AS provider, c.name_ar,
            app.service_cost(p.code, c.code)::text AS cost,
            r.priority, r.status,
            (SELECT max(health_status) FROM tenant_provider_binding b WHERE b.provider = c.code)
              AS health
     FROM products p
     CROSS JOIN provider_catalog c
     LEFT JOIN product_provider_routing r
       ON r.product_code = p.code AND r.provider = c.code
     WHERE p.status <> 'retired' AND c.status = 'active'
     ORDER BY p.code, r.priority NULLS LAST, c.code`,
  );

  const { rows: served } = await db.query<{
    product_code: string;
    provider: string;
    calls: number;
    failed: number;
    last_call_at: Date;
  }>(
    `SELECT product_code, provider, sum(calls)::int AS calls, sum(failed)::int AS failed,
            max(last_call_at) AS last_call_at
     FROM provider_usage
     WHERE period_start >= date_trunc('month', now() - interval '1 month')::date
     GROUP BY product_code, provider
     ORDER BY product_code, calls DESC`,
  );

  return services.map((service) => {
    const mine = offers.filter((offer) => offer.product_code === service.code);
    const routed = mine
      .filter((offer) => offer.status === 'active')
      .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));
    const servedBy = routed[0]?.provider ?? null;
    const priceHalalas = service.price === null ? null : riyalsToHalalas(service.price);
    const chosen = mine.find((offer) => offer.provider === servedBy);
    const costHalalas =
      chosen?.cost === null || chosen?.cost === undefined ? null : riyalsToHalalas(chosen.cost);

    return {
      productCode: service.code,
      nameAr: service.name_ar,
      servedBy,
      priceHalalas,
      costHalalas,
      marginPct: marginOf(priceHalalas, costHalalas),
      offers: mine.map((offer) => ({
        provider: offer.provider,
        nameAr: offer.name_ar,
        costHalalas: offer.cost === null ? null : riyalsToHalalas(offer.cost),
        serves: offer.cost !== null,
        routed: offer.status !== null,
        priority: offer.priority,
        status: offer.status,
        health: offer.health ?? 'unknown',
      })),
      served: served
        .filter((row) => row.product_code === service.code)
        .map((row) => ({
          provider: row.provider,
          calls: row.calls,
          failed: row.failed,
          lastCallAt: row.last_call_at,
        })),
    };
  });
}

/** The margin a price would give under the provider that will actually serve the call. */
export function marginUnder(
  priceHalalas: number | null,
  costHalalas: number | null,
): number | null {
  return marginOf(priceHalalas, costHalalas);
}

/** Riyals, for a screen that prints money. */
export function costInRiyals(costHalalas: number | null): string | null {
  return costHalalas === null ? null : halalasToRiyals(costHalalas).toFixed(2);
}

/**
 * Counts a call against the provider that made it.
 *
 * Written as the call happens, from inside the subscriber's own transaction, because reading
 * runs across subscribers to answer «did the calls move» is exactly what rule 2 forbids. The
 * counter carries a provider, a service and a number, and no customer, subject or identifier.
 *
 * Inside a savepoint, and a failure here is swallowed: a counter that can abort the transaction
 * it is counting turns a verification into a refusal over a statistic. This one already did,
 * once, during its own first test run.
 */
export async function countProviderCall(
  tx: TenantTransaction,
  input: {
    provider: string;
    productCode: string;
    endpoint: string;
    failed: boolean;
    costHalalas?: number | undefined;
  },
): Promise<void> {
  await withSavepoint(tx, async () => {
    await tx.query(
      `INSERT INTO provider_usage
       (provider, product_code, endpoint, period_start, calls, failed, cost_halalas, last_call_at)
     VALUES ($1, $2, $3, date_trunc('month', now())::date, 1, $4, $5, now())
       ON CONFLICT (provider, product_code, endpoint, period_start) DO UPDATE SET
         calls = provider_usage.calls + 1,
         failed = provider_usage.failed + EXCLUDED.failed,
         cost_halalas = provider_usage.cost_halalas + EXCLUDED.cost_halalas,
         last_call_at = now()`,
      [
        input.provider,
        input.productCode,
        input.endpoint,
        input.failed ? 1 : 0,
        Math.max(0, Math.round(input.costHalalas ?? 0)),
      ],
    );
  }).catch(() => undefined);
}
