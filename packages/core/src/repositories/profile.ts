import type { TenantTransaction } from '@nx-verify/db';

/**
 * The profile is a projection, not a table (concept 3). Every field carries its
 * authority and its observed_at, because rule 6 refuses a field that carries neither.
 */

export type Freshness = 'fresh' | 'expiring' | 'expired' | 'permanent';

export interface ProfileField {
  fieldPath: string;
  value: unknown;
  authority: string | null;
  observedAt: Date;
  validUntil: Date | null;
  confidence: number;
  freshness: Freshness;
  attestationId: string;
}

export async function getEntityProfile(
  tx: TenantTransaction,
  entityId: string,
): Promise<ProfileField[]> {
  const { rows } = await tx.query<{
    field_path: string;
    value: unknown;
    authority: string | null;
    observed_at: Date;
    valid_until: Date | null;
    confidence: string;
    freshness: Freshness;
    attestation_id: string;
  }>(
    `SELECT field_path, value, authority, observed_at, valid_until, confidence,
            freshness, attestation_id
     FROM entity_profile
     WHERE tenant_id = $1 AND entity_id = $2
     ORDER BY field_path`,
    [tx.tenantId, entityId],
  );

  return rows.map((row) => ({
    fieldPath: row.field_path,
    value: row.value,
    authority: row.authority,
    observedAt: row.observed_at,
    validUntil: row.valid_until,
    confidence: Number(row.confidence),
    freshness: row.freshness,
    attestationId: row.attestation_id,
  }));
}
