import type { TenantTransaction } from '@nx-verify/db';
import { canonicalJson } from '../canonical-json.js';

/**
 * Change detection, step 4 of the sequence in docs/02-schema.md section 7.
 *
 * A re-verification that returns the same value writes a new attestation and no event.
 * That distinction is the product: "we confirmed this on Tuesday" and "this changed on
 * Tuesday" are different answers, and an alert that fires on every re-verification is an
 * alert nobody reads.
 *
 * Severity comes from rows, so a tenant can be given its own reading of a field without
 * a release.
 */

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface RecordChangeInput {
  entityId: string;
  fieldPath: string;
  oldAttestationId: string | null;
  newAttestationId: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface RecordedChange {
  changeEventId: string;
  severity: Severity;
  reasonAr: string | null;
  reasonEn: string | null;
}

export async function recordChangeEvent(
  tx: TenantTransaction,
  input: RecordChangeInput,
): Promise<RecordedChange | null> {
  if (canonicalJson(input.oldValue) === canonicalJson(input.newValue)) {
    // A renewal, not a change. No event.
    return null;
  }

  const rule = await resolveSeverity(tx, input.fieldPath, input.oldValue, input.newValue);

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO change_events
       (tenant_id, entity_id, field_path, old_attestation, new_attestation,
        severity, reason_ar, reason_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      tx.tenantId,
      input.entityId,
      input.fieldPath,
      input.oldAttestationId,
      input.newAttestationId,
      rule.severity,
      rule.reasonAr,
      rule.reasonEn,
    ],
  );

  const id = rows[0]?.id;
  return id === undefined
    ? null
    : {
        changeEventId: id,
        severity: rule.severity,
        reasonAr: rule.reasonAr,
        reasonEn: rule.reasonEn,
      };
}

interface ResolvedSeverity {
  severity: Severity;
  reasonAr: string | null;
  reasonEn: string | null;
}

async function resolveSeverity(
  tx: TenantTransaction,
  fieldPath: string,
  oldValue: unknown,
  newValue: unknown,
): Promise<ResolvedSeverity> {
  const { rows } = await tx.query<{
    severity: Severity;
    from_value: unknown;
    to_value: unknown;
    reason_ar: string;
    reason_en: string;
  }>(
    `SELECT severity, from_value, to_value, reason_ar, reason_en
     FROM change_severity_rules
     WHERE field_path = $2 AND (tenant_id IS NULL OR tenant_id = $1)
     ORDER BY tenant_id NULLS LAST, seq`,
    [tx.tenantId, fieldPath],
  );

  for (const rule of rows) {
    // A rule with no values matches any change to the field. One with values matches only
    // that transition, which is how "active to anything else" is expressed without a
    // list of every possible destination.
    const fromMatches =
      rule.from_value === null || canonicalJson(rule.from_value) === canonicalJson(oldValue);
    const toMatches =
      rule.to_value === null || canonicalJson(rule.to_value) === canonicalJson(newValue);

    if (fromMatches && toMatches) {
      return { severity: rule.severity, reasonAr: rule.reason_ar, reasonEn: rule.reason_en };
    }
  }

  return { severity: 'INFO', reasonAr: null, reasonEn: null };
}

export interface ChangeEventView {
  changeEventId: string;
  entityId: string;
  fieldPath: string;
  severity: Severity;
  reasonAr: string | null;
  detectedAt: Date;
  acknowledgedAt: Date | null;
}

export async function listChangeEvents(
  tx: TenantTransaction,
  options: { entityId?: string; openOnly?: boolean; limit?: number } = {},
): Promise<ChangeEventView[]> {
  const { rows } = await tx.query<{
    id: string;
    entity_id: string;
    field_path: string;
    severity: Severity;
    reason_ar: string | null;
    detected_at: Date;
    acknowledged_at: Date | null;
  }>(
    `SELECT id, entity_id, field_path, severity, reason_ar, detected_at, acknowledged_at
     FROM change_events
     WHERE tenant_id = $1
       AND ($2::uuid IS NULL OR entity_id = $2)
       AND (NOT $3::boolean OR acknowledged_at IS NULL)
     ORDER BY detected_at DESC
     LIMIT $4`,
    [tx.tenantId, options.entityId ?? null, options.openOnly ?? false, options.limit ?? 100],
  );

  return rows.map((row) => ({
    changeEventId: row.id,
    entityId: row.entity_id,
    fieldPath: row.field_path,
    severity: row.severity,
    reasonAr: row.reason_ar,
    detectedAt: row.detected_at,
    acknowledgedAt: row.acknowledged_at,
  }));
}

export async function acknowledgeChange(
  tx: TenantTransaction,
  changeEventId: string,
  actor: string,
): Promise<void> {
  await tx.query(
    `UPDATE change_events
     SET acknowledged_by = $3, acknowledged_at = now()
     WHERE tenant_id = $1 AND id = $2 AND acknowledged_at IS NULL`,
    [tx.tenantId, changeEventId, actor],
  );
}
