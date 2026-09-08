import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import type { Freshness } from './profile.js';

/**
 * Freshness policy.
 *
 * ADR-007: a TTL edit recomputes and writes nothing. Every function here touches
 * freshness_policy alone, and not one of them can reach attestations. Guard 07 proves
 * that byte for byte rather than trusting the shape of this file.
 *
 * The impact preview exists because the console must show the operator what an edit will
 * do before it is saved: "340 entities move to expired". Changing a TTL blind is how a
 * compliance team wakes up to an alert storm.
 */

export interface FreshnessPolicyRow {
  fieldPath: string;
  ttlDays: number;
  weight: number;
  /** Whether this row is the system default or an override this tenant saved. */
  source: 'system' | 'tenant';
}

export async function listFreshnessPolicy(tx: TenantTransaction): Promise<FreshnessPolicyRow[]> {
  const { rows } = await tx.query<{
    field_path: string;
    ttl_days: number;
    weight: number;
    tenant_id: string | null;
  }>(
    `SELECT DISTINCT ON (field_path) field_path, ttl_days, weight, tenant_id
     FROM freshness_policy
     WHERE portfolio_id IS NULL AND (tenant_id IS NULL OR tenant_id = $1)
     ORDER BY field_path, tenant_id NULLS LAST`,
    [tx.tenantId],
  );

  return rows.map((row) => ({
    fieldPath: row.field_path,
    ttlDays: row.ttl_days,
    weight: row.weight,
    source: row.tenant_id === null ? 'system' : 'tenant',
  }));
}

export interface SetTtlInput {
  fieldPath: string;
  ttlDays: number;
  weight: number;
}

/**
 * The weight moves with the TTL on purpose. The confidence score is built from these
 * weights, and a duration without a weight has no meaning in that calculation.
 */
export async function setTenantTtl(tx: TenantTransaction, input: SetTtlInput): Promise<void> {
  if (input.ttlDays <= 0) {
    throw new NxError('NX-4001', { detail: 'ttl_days must be greater than zero' });
  }

  await tx.query(
    `INSERT INTO freshness_policy (tenant_id, portfolio_id, field_path, ttl_days, weight)
     VALUES ($1, NULL, $2, $3, $4)
     ON CONFLICT ((COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
                  (COALESCE(portfolio_id, '00000000-0000-0000-0000-000000000000'::uuid)),
                  field_path)
     DO UPDATE SET ttl_days = EXCLUDED.ttl_days,
                   weight = EXCLUDED.weight,
                   updated_at = now()`,
    [tx.tenantId, input.fieldPath, input.ttlDays, input.weight],
  );
}

/** Returns the field to the system default. */
export async function clearTenantTtl(tx: TenantTransaction, fieldPath: string): Promise<void> {
  await tx.query(
    `DELETE FROM freshness_policy
     WHERE tenant_id = $1 AND portfolio_id IS NULL AND field_path = $2`,
    [tx.tenantId, fieldPath],
  );
}

export type FreshnessCounts = Record<Freshness, number>;

export interface TtlChangePreview {
  fieldPath: string;
  currentTtlDays: number | null;
  proposedTtlDays: number;
  before: FreshnessCounts;
  after: FreshnessCounts;
  /** Entities that move into the expired state if the change is saved. */
  newlyExpired: number;
}

export async function previewTtlChange(
  tx: TenantTransaction,
  fieldPath: string,
  proposedTtlDays: number,
): Promise<TtlChangePreview> {
  if (proposedTtlDays <= 0) {
    throw new NxError('NX-4001', { detail: 'ttl_days must be greater than zero' });
  }

  const { rows } = await tx.query<{
    current_ttl: number | null;
    before_state: Freshness;
    after_state: Freshness;
    entities: string;
  }>(
    `WITH policy AS (
       SELECT ttl_days
       FROM freshness_policy
       WHERE ($2 = field_path OR $2 LIKE field_path || '.%')
         AND portfolio_id IS NULL
         AND (tenant_id = $1 OR tenant_id IS NULL)
       ORDER BY tenant_id NULLS LAST, length(field_path) DESC
       LIMIT 1
     ),
     live AS (
       SELECT DISTINCT ON (entity_id) entity_id, observed_at, valid_until
       FROM attestations
       WHERE tenant_id = $1
         AND ($2 = field_path OR field_path LIKE $2 || '.%')
         AND superseded_by IS NULL
       ORDER BY entity_id, observed_at DESC
     )
     SELECT (SELECT ttl_days FROM policy) AS current_ttl,
            app.freshness_state(
              COALESCE(l.valid_until, l.observed_at + make_interval(days => (SELECT ttl_days FROM policy))),
              (SELECT ttl_days FROM policy)
            ) AS before_state,
            app.freshness_state(
              COALESCE(l.valid_until, l.observed_at + make_interval(days => $3::int)),
              $3::int
            ) AS after_state,
            count(*)::text AS entities
     FROM live l
     GROUP BY 1, 2, 3`,
    [tx.tenantId, fieldPath, proposedTtlDays],
  );

  const before = emptyCounts();
  const after = emptyCounts();
  let newlyExpired = 0;
  let currentTtlDays: number | null = null;

  for (const row of rows) {
    const count = Number(row.entities);
    currentTtlDays = row.current_ttl;
    before[row.before_state] += count;
    after[row.after_state] += count;
    if (row.before_state !== 'expired' && row.after_state === 'expired') {
      newlyExpired += count;
    }
  }

  return { fieldPath, currentTtlDays, proposedTtlDays, before, after, newlyExpired };
}

function emptyCounts(): FreshnessCounts {
  return { fresh: 0, expiring: 0, expired: 0, permanent: 0 };
}
