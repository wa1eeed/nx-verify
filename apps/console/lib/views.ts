import type { TenantTransaction } from '@nx-verify/db';

/**
 * The registry and its saved views.
 *
 * ADR-002 in the interface: there is one table for every kind of entity, and a saved view
 * is a filter over it rather than a screen of its own. That is why the tenth product
 * needs no new page.
 *
 * A saved view is a piece of work, not a filter. alert_on_enter is what turns "IBANs" into
 * "tell me when a new IBAN appears", and it is the reason these are worth naming at all.
 */

export interface SavedView {
  key: string;
  labelAr: string;
  entityType: string;
  alertOnEnter: boolean;
}

export const SAVED_VIEWS: readonly SavedView[] = [
  { key: 'businesses', labelAr: 'قائمة العملاء', entityType: 'BUSINESS', alertOnEnter: false },
  {
    key: 'freelancers',
    labelAr: 'شهادات العمل الحر',
    entityType: 'FREELANCER',
    alertOnEnter: true,
  },
  { key: 'ibans', labelAr: 'الآيبانات', entityType: 'BANK_ACCOUNT', alertOnEnter: true },
  { key: 'properties', labelAr: 'العقارات', entityType: 'PROPERTY', alertOnEnter: false },
  { key: 'people', labelAr: 'الأشخاص', entityType: 'PERSON', alertOnEnter: false },
];

export function findView(key: string | undefined): SavedView {
  return SAVED_VIEWS.find((view) => view.key === key) ?? (SAVED_VIEWS[0] as SavedView);
}

export interface RegistryRow {
  entityId: string;
  displayName: string | null;
  entityType: string;
  lastSeenAt: Date;
  fieldCount: number;
  expiredCount: number;
  worstFreshness: 'fresh' | 'expiring' | 'expired' | 'permanent';
}

export async function listRegistry(
  tx: TenantTransaction,
  entityType: string,
  limit = 100,
): Promise<RegistryRow[]> {
  const { rows } = await tx.query<{
    entity_id: string;
    display_name: string | null;
    entity_type: string;
    last_seen_at: Date;
    field_count: string;
    expired_count: string;
    expiring_count: string;
  }>(
    `SELECT e.id AS entity_id,
            e.display_name,
            e.entity_type,
            e.last_seen_at,
            count(p.field_path)::text AS field_count,
            count(*) FILTER (WHERE p.freshness = 'expired')::text AS expired_count,
            count(*) FILTER (WHERE p.freshness = 'expiring')::text AS expiring_count
     FROM entities e
     LEFT JOIN entity_profile p ON p.tenant_id = e.tenant_id AND p.entity_id = e.id
     WHERE e.tenant_id = $1 AND e.entity_type = $2 AND e.archived_at IS NULL
     GROUP BY e.id, e.display_name, e.entity_type, e.last_seen_at
     ORDER BY e.last_seen_at DESC
     LIMIT $3`,
    [tx.tenantId, entityType, limit],
  );

  return rows.map((row) => ({
    entityId: row.entity_id,
    displayName: row.display_name,
    entityType: row.entity_type,
    lastSeenAt: row.last_seen_at,
    fieldCount: Number(row.field_count),
    expiredCount: Number(row.expired_count),
    worstFreshness:
      Number(row.expired_count) > 0
        ? 'expired'
        : Number(row.expiring_count) > 0
          ? 'expiring'
          : Number(row.field_count) > 0
            ? 'fresh'
            : 'permanent',
  }));
}

export interface CompletenessGap {
  fieldPath: string;
  missingEntities: number;
}

/**
 * What is missing across the registry.
 *
 * docs/01-blueprint.md section 5.5: the platform knows what is absent and can offer to
 * fill it. The customer's incentive and ours point the same way here, which is rare
 * enough to be worth building.
 */
export async function findCompletenessGaps(
  tx: TenantTransaction,
  entityType: string,
  fieldPaths: readonly string[],
): Promise<CompletenessGap[]> {
  const { rows } = await tx.query<{ field_path: string; missing: string }>(
    `SELECT f.field_path,
            count(e.id)::text AS missing
     FROM unnest($2::text[]) AS f(field_path)
     CROSS JOIN entities e
     WHERE e.tenant_id = $1 AND e.entity_type = $3 AND e.archived_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM entity_profile p
         WHERE p.tenant_id = e.tenant_id AND p.entity_id = e.id AND p.field_path = f.field_path
       )
     GROUP BY f.field_path
     HAVING count(e.id) > 0
     ORDER BY count(e.id) DESC`,
    [tx.tenantId, [...fieldPaths], entityType],
  );

  return rows.map((row) => ({
    fieldPath: row.field_path,
    missingEntities: Number(row.missing),
  }));
}
