import type { TenantTransaction } from '@nx-verify/db';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import { findEntityIdByIdentifier } from '../repositories/identifiers.js';
import type { CustomerKind } from './checks.js';

/**
 * The customers list.
 *
 * Customers are the companies, establishments and freelancers a subscriber verified. The
 * people and accounts found inside those verifications are not customers: they appear in
 * the files they belong to, and a person who manages three customers is shown there, not
 * as a fourth row here.
 *
 * Built from the profile in one query, so a list of a hundred customers is one round trip
 * and not a hundred files assembled and thrown away. Searching accepts a name or a number:
 * a number is looked up by its keyed hash, the only way it can be found (rule 4).
 */

export interface CustomerRow {
  entityId: string;
  displayName: string | null;
  kind: CustomerKind | null;
  entityType: string;
  /** The registry status for a business, the certificate status for a freelancer. */
  statusText: string | null;
  statusTone: 'fresh' | 'critical' | 'neutral';
  lastVerifiedAt: Date | null;
  expiredFacts: number;
  /** Detected changes not yet acknowledged, and answers that deserve a look. */
  attention: number;
}

export interface CustomerFilter {
  kind?: CustomerKind | null;
  search?: string | null;
  limit?: number;
}

const CERTIFICATE_WORDS: Readonly<Record<string, string>> = {
  ACTIVE: 'سارية',
  EXPIRED: 'منتهية',
  CANCELED: 'ملغاة',
  REVOKED: 'مسحوبة',
};

export async function listCustomers(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  filter: CustomerFilter = {},
): Promise<CustomerRow[]> {
  const search = filter.search?.trim() ?? '';
  let byIdentifier: string | null = null;
  if (/^[0-9]{10}$/.test(search)) {
    for (const idType of ['UNN', 'CR', 'NATIONAL_ID', 'IQAMA'] as const) {
      byIdentifier = await findEntityIdByIdentifier(tx, keys, idType, search);
      if (byIdentifier) {
        break;
      }
    }
    if (byIdentifier === null) {
      return [];
    }
  }

  const { rows } = await tx.query<{
    entity_id: string;
    display_name: string | null;
    entity_type: string;
    kind: unknown;
    status_text: unknown;
    status_code: unknown;
    certificate: unknown;
    iban: unknown;
    last_verified_at: Date | null;
    expired: string;
    open_changes: string;
  }>(
    `SELECT e.id AS entity_id, e.display_name, e.entity_type,
            (array_agg(p.value) FILTER (WHERE p.field_path = 'cr.kind'))[1] AS kind,
            (array_agg(p.value) FILTER (WHERE p.field_path = 'cr.status'))[1] AS status_text,
            (array_agg(p.value) FILTER (WHERE p.field_path = 'cr.status_code'))[1] AS status_code,
            (array_agg(p.value) FILTER (WHERE p.field_path = 'freelance.certificate_status'))[1] AS certificate,
            (array_agg(p.value) FILTER (WHERE p.field_path = 'bank.iban_ownership'))[1] AS iban,
            max(p.observed_at) AS last_verified_at,
            count(*) FILTER (WHERE p.freshness = 'expired')::text AS expired,
            (SELECT count(*) FROM change_events c
             WHERE c.tenant_id = e.tenant_id AND c.entity_id = e.id AND c.acknowledged_at IS NULL)::text AS open_changes
     FROM entities e
     LEFT JOIN entity_profile p ON p.tenant_id = e.tenant_id AND p.entity_id = e.id
     WHERE e.tenant_id = $1
       AND e.entity_type IN ('BUSINESS', 'FREELANCER')
       AND e.archived_at IS NULL
       AND ($2::uuid IS NULL OR e.id = $2)
       AND ($3::text IS NULL OR e.display_name ILIKE '%' || $3 || '%')
       AND (
         $4::text IS NULL
         OR ($4 = 'FREELANCER' AND e.entity_type = 'FREELANCER')
         OR ($4 IN ('COMPANY', 'ESTABLISHMENT') AND e.entity_type = 'BUSINESS' AND EXISTS (
           SELECT 1 FROM entity_profile k
           WHERE k.tenant_id = e.tenant_id AND k.entity_id = e.id
             AND k.field_path = 'cr.kind' AND k.value = to_jsonb($4::text)
         ))
       )
       -- A company first met as another company's partner has no verification of its own
       -- and is not a customer until somebody verifies it.
       AND EXISTS (SELECT 1 FROM verification_runs r WHERE r.tenant_id = e.tenant_id AND r.entity_id = e.id)
     GROUP BY e.id, e.display_name, e.entity_type, e.last_seen_at
     ORDER BY max(p.observed_at) DESC NULLS LAST, e.last_seen_at DESC
     LIMIT $5`,
    [
      tx.tenantId,
      byIdentifier,
      byIdentifier === null && search !== '' ? search : null,
      filter.kind ?? null,
      Math.min(Math.max(filter.limit ?? 100, 1), 5_000),
    ],
  );

  return rows.map((row) => {
    const freelancer = row.entity_type === 'FREELANCER';
    const kind: CustomerKind | null = freelancer
      ? 'FREELANCER'
      : row.kind === 'COMPANY' || row.kind === 'ESTABLISHMENT'
        ? row.kind
        : null;
    const statusText = freelancer
      ? typeof row.certificate === 'string'
        ? (CERTIFICATE_WORDS[row.certificate] ?? row.certificate)
        : null
      : typeof row.status_text === 'string'
        ? row.status_text
        : null;
    const healthy = freelancer ? row.certificate === 'ACTIVE' : row.status_code === 1;
    const known = freelancer ? row.certificate !== null : row.status_code !== null;
    const mismatched = row.iban === 'NO_MATCH' || row.iban === 'PARTIAL' ? 1 : 0;
    return {
      entityId: row.entity_id,
      displayName: row.display_name,
      kind,
      entityType: row.entity_type,
      statusText,
      statusTone: !known ? 'neutral' : healthy ? 'fresh' : 'critical',
      lastVerifiedAt: row.last_verified_at,
      expiredFacts: Number(row.expired),
      attention: Number(row.open_changes) + mismatched + (known && !healthy ? 1 : 0),
    };
  });
}

export interface CustomerCounts {
  all: number;
  companies: number;
  establishments: number;
  freelancers: number;
}

export async function countCustomers(tx: TenantTransaction): Promise<CustomerCounts> {
  const { rows } = await tx.query<{
    all: string;
    companies: string;
    establishments: string;
    freelancers: string;
  }>(
    `SELECT count(*)::text AS all,
            count(*) FILTER (WHERE k.value = '"COMPANY"'::jsonb)::text AS companies,
            count(*) FILTER (WHERE k.value = '"ESTABLISHMENT"'::jsonb)::text AS establishments,
            count(*) FILTER (WHERE e.entity_type = 'FREELANCER')::text AS freelancers
     FROM entities e
     LEFT JOIN entity_profile k ON k.tenant_id = e.tenant_id AND k.entity_id = e.id AND k.field_path = 'cr.kind'
     WHERE e.tenant_id = $1 AND e.entity_type IN ('BUSINESS', 'FREELANCER') AND e.archived_at IS NULL
       AND EXISTS (SELECT 1 FROM verification_runs r WHERE r.tenant_id = e.tenant_id AND r.entity_id = e.id)`,
    [tx.tenantId],
  );
  const row = rows[0];
  return {
    all: Number(row?.all ?? 0),
    companies: Number(row?.companies ?? 0),
    establishments: Number(row?.establishments ?? 0),
    freelancers: Number(row?.freelancers ?? 0),
  };
}
