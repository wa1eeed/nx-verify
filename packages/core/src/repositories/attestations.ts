import { createHash } from 'node:crypto';
import type { TenantTransaction } from '@nx-verify/db';
import { canonicalJson } from '../canonical-json.js';
import { NxError } from '../errors.js';

/**
 * Writing an attestation.
 *
 * The sequence is the one in docs/02-schema.md section 7, and step 3 is the part that
 * teams get wrong: a re-verification that returns the same value still inserts a new
 * row. That is what keeps "when did we last confirm this" separate from "when did this
 * last change". Updating observed_at in place would collapse the two and the answer to
 * the audit question would be gone for good.
 */

export interface RecordAttestationInput {
  entityId: string;
  fieldPath: string;
  value: unknown;
  /** Internal only. Rule 5: never leaves the system in a public response. */
  source: string;
  /** The official body the fact came from. This is what callers see. */
  authority: string | null;
  runId: string;
  observedAt: Date;
  validFrom?: Date;
  validUntil?: Date | null;
  confidence?: number;
  evidenceId?: string | null;
}

export interface RecordAttestationResult {
  attestationId: string;
  previousAttestationId: string | null;
  /** True when the value differs from the previous live attestation for the field. */
  changed: boolean;
  /** True when there was no previous attestation for the field. */
  firstObservation: boolean;
  /** The value being replaced, so change detection does not have to read it back. */
  previousValue: unknown;
}

export function hashValue(value: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest();
}

export async function recordAttestation(
  tx: TenantTransaction,
  input: RecordAttestationInput,
): Promise<RecordAttestationResult> {
  const valueHash = hashValue(input.value);
  const validFrom = input.validFrom ?? input.observedAt;

  // Lock the live rows for this field so two concurrent writers cannot both believe they
  // are superseding the same predecessor.
  const { rows: liveRows } = await tx.query<{ id: string; value_hash: Buffer; value: unknown }>(
    `SELECT id, value_hash, value
     FROM attestations
     WHERE tenant_id = $1 AND entity_id = $2 AND field_path = $3 AND superseded_by IS NULL
     ORDER BY observed_at DESC
     FOR UPDATE`,
    [tx.tenantId, input.entityId, input.fieldPath],
  );

  const previous = liveRows[0] ?? null;

  const { rows: inserted } = await tx.query<{ id: string }>(
    `INSERT INTO attestations
       (tenant_id, entity_id, field_path, value, value_hash, source, authority,
        run_id, observed_at, valid_from, valid_until, confidence, evidence_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      tx.tenantId,
      input.entityId,
      input.fieldPath,
      canonicalJson(input.value),
      valueHash,
      input.source,
      input.authority,
      input.runId,
      input.observedAt,
      validFrom,
      input.validUntil ?? null,
      input.confidence ?? 1,
      input.evidenceId ?? null,
    ],
  );

  const attestationId = inserted[0]?.id;
  if (!attestationId) {
    throw new NxError('NX-5001', { detail: 'attestation insert returned no id' });
  }

  if (liveRows.length > 0) {
    // The only UPDATE this system performs on attestations, and the trigger in migration
    // 0004 verifies that it changes nothing but this column.
    await tx.query(
      `UPDATE attestations
       SET superseded_by = $1
       WHERE tenant_id = $2 AND entity_id = $3 AND field_path = $4
         AND superseded_by IS NULL AND id <> $1`,
      [attestationId, tx.tenantId, input.entityId, input.fieldPath],
    );
  }

  return {
    attestationId,
    previousAttestationId: previous?.id ?? null,
    changed: previous !== null && !previous.value_hash.equals(valueHash),
    firstObservation: previous === null,
    previousValue: previous?.value ?? null,
  };
}

export interface AttestationTimelineEntry {
  attestationId: string;
  fieldPath: string;
  value: unknown;
  authority: string | null;
  observedAt: Date;
  validUntil: Date | null;
  supersededBy: string | null;
  runId: string;
}

/**
 * The entity timeline. Rule 5 again: `source` is not selected, so a provider name cannot
 * reach a caller through this path even by accident.
 */
export async function getAttestationTimeline(
  tx: TenantTransaction,
  entityId: string,
  options: { fieldPath?: string; limit?: number } = {},
): Promise<AttestationTimelineEntry[]> {
  const { rows } = await tx.query<{
    id: string;
    field_path: string;
    value: unknown;
    authority: string | null;
    observed_at: Date;
    valid_until: Date | null;
    superseded_by: string | null;
    run_id: string;
  }>(
    `SELECT id, field_path, value, authority, observed_at, valid_until, superseded_by, run_id
     FROM attestations
     WHERE tenant_id = $1 AND entity_id = $2
       AND ($3::text IS NULL OR field_path = $3)
     ORDER BY observed_at DESC, created_at DESC
     LIMIT $4`,
    [tx.tenantId, entityId, options.fieldPath ?? null, options.limit ?? 200],
  );

  return rows.map((row) => ({
    attestationId: row.id,
    fieldPath: row.field_path,
    value: row.value,
    authority: row.authority,
    observedAt: row.observed_at,
    validUntil: row.valid_until,
    supersededBy: row.superseded_by,
    runId: row.run_id,
  }));
}
