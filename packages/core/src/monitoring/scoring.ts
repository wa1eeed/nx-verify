import type { TenantTransaction } from '@nx-verify/db';

/**
 * The confidence score, and its working.
 *
 * The weights are the ones already in freshness_policy, because a duration and its weight
 * belong together: a field that matters more is worth checking more often, and saying so
 * twice invites the two to drift apart.
 *
 * Fresh earns its full weight, expiring earns 55 percent, expired earns nothing. The
 * breakdown is stored alongside the number and is not optional. A score without its
 * working is refused by risk management, and with it goes the only reason to have one.
 */

const EXPIRING_FACTOR = 0.55;

export interface ScoreComponent {
  fieldPath: string;
  weight: number;
  freshness: string;
  earned: number;
}

export interface EntityScore {
  entityId: string;
  score: number;
  breakdown: {
    components: ScoreComponent[];
    totalWeight: number;
    earnedWeight: number;
    missingFields: string[];
  };
}

export async function computeScore(tx: TenantTransaction, entityId: string): Promise<EntityScore> {
  const { rows } = await tx.query<{
    field_path: string;
    weight: number | null;
    freshness: string;
  }>(
    `SELECT field_path, weight, freshness
     FROM entity_profile
     WHERE tenant_id = $1 AND entity_id = $2`,
    [tx.tenantId, entityId],
  );

  const { rows: policy } = await tx.query<{ field_path: string; weight: number }>(
    `SELECT DISTINCT ON (field_path) field_path, weight
     FROM freshness_policy
     WHERE portfolio_id IS NULL AND (tenant_id IS NULL OR tenant_id = $1)
     ORDER BY field_path, tenant_id NULLS LAST`,
    [tx.tenantId],
  );

  const weights = new Map(policy.map((row) => [row.field_path, row.weight]));
  const present = new Set<string>();
  const components: ScoreComponent[] = [];
  let earnedWeight = 0;

  for (const row of rows) {
    // A field's weight is looked up by its policy prefix, so cr.core.capital counts under
    // cr.core rather than falling out of the score because nobody wrote a row for it.
    const weight = row.weight ?? weightFor(row.field_path, weights);
    if (weight === null) {
      continue;
    }
    present.add(prefixFor(row.field_path, weights) ?? row.field_path);

    const earned =
      row.freshness === 'expired'
        ? 0
        : row.freshness === 'expiring'
          ? Math.round(weight * EXPIRING_FACTOR)
          : weight;

    earnedWeight += earned;
    components.push({
      fieldPath: row.field_path,
      weight,
      freshness: row.freshness,
      earned,
    });
  }

  const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  const missingFields = [...weights.keys()].filter((fieldPath) => !present.has(fieldPath));
  const cappedEarned = Math.min(earnedWeight, totalWeight);
  const score = totalWeight === 0 ? 0 : Math.round((cappedEarned / totalWeight) * 100);

  return {
    entityId,
    score,
    breakdown: { components, totalWeight, earnedWeight: cappedEarned, missingFields },
  };
}

export async function storeScore(tx: TenantTransaction, score: EntityScore): Promise<void> {
  await tx.query(
    `INSERT INTO entity_scores (tenant_id, entity_id, score, breakdown)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (tenant_id, entity_id) DO UPDATE SET
       score = EXCLUDED.score,
       breakdown = EXCLUDED.breakdown,
       computed_at = now()`,
    [tx.tenantId, score.entityId, score.score, JSON.stringify(score.breakdown)],
  );
}

function prefixFor(fieldPath: string, weights: ReadonlyMap<string, number>): string | null {
  if (weights.has(fieldPath)) {
    return fieldPath;
  }
  const segments = fieldPath.split('.');
  for (let length = segments.length - 1; length > 0; length -= 1) {
    const prefix = segments.slice(0, length).join('.');
    if (weights.has(prefix)) {
      return prefix;
    }
  }
  return null;
}

function weightFor(fieldPath: string, weights: ReadonlyMap<string, number>): number | null {
  const prefix = prefixFor(fieldPath, weights);
  return prefix === null ? null : (weights.get(prefix) ?? null);
}
