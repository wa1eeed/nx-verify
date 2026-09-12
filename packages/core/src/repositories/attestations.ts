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

export interface FieldHistoryEntry {
  attestationId: string;
  value: unknown;
  authority: string | null;
  observedAt: Date;
  validUntil: Date | null;
  /** True for the value in force now. Everything below it is what it replaced. */
  current: boolean;
  /** True when this value differs from the one before it. */
  changed: boolean;
  runId: string;
}

/**
 * Everything ever known about one field, newest first.
 *
 * This is the whole reason attestations are never updated. A verification does not
 * overwrite what the previous one found: it adds a row and marks the old one superseded,
 * so a question asked a year later has an answer. Until now that history was in the
 * database and nowhere a person could see it.
 *
 * The comparison that produces `changed` is done here rather than on the screen, because
 * it is the same question the change detector asks and the two must not drift into
 * disagreeing about what counts as a change.
 */
export async function getFieldHistory(
  tx: TenantTransaction,
  entityId: string,
  fieldPath: string,
  limit = 50,
): Promise<FieldHistoryEntry[]> {
  const { rows } = await tx.query<{
    id: string;
    value: unknown;
    authority: string | null;
    observed_at: Date;
    valid_until: Date | null;
    superseded_by: string | null;
    run_id: string;
  }>(
    `SELECT id, value, authority, observed_at, valid_until, superseded_by, run_id
     FROM attestations
     WHERE tenant_id = $1 AND entity_id = $2 AND field_path = $3
     ORDER BY observed_at DESC, created_at DESC
     LIMIT $4`,
    [tx.tenantId, entityId, fieldPath, limit],
  );

  return rows.map((row, index) => {
    const previous = rows[index + 1];
    return {
      attestationId: row.id,
      value: row.value,
      authority: row.authority,
      observedAt: row.observed_at,
      validUntil: row.valid_until,
      current: row.superseded_by === null,
      // The oldest row we hold is not a change: there was nothing before it to differ
      // from, and calling it one would put a change marker on every first verification.
      changed: previous === undefined ? false : !sameValue(row.value, previous.value),
      runId: row.run_id,
    };
  });
}

export interface VerificationInHistory {
  runId: string;
  /** The number a person reads out loud, once the run has one. */
  reference: string | null;
  productCode: string;
  at: Date;
  decision: string | null;
  /** What started it: a call, a person, a monitor sweep, a batch. */
  triggeredBy: string;
  /** What this verification wrote, and whether each field was new, changed or confirmed. */
  fields: { fieldPath: string; value: unknown; kind: 'new' | 'changed' | 'confirmed' }[];
}

/**
 * The entity's verifications, newest first, each with what it actually produced.
 *
 * A flat list of facts does not answer the question a person opens this file with: what
 * did the last check tell us that the one before it did not. So the facts are grouped by
 * the verification that produced them, and each is marked as new, changed, or merely
 * confirmed. Confirmation is not nothing: a field re-read and found identical is the
 * most common and most reassuring outcome there is, and a timeline that hides it looks
 * like nothing happened.
 */
export async function getVerificationHistory(
  tx: TenantTransaction,
  entityId: string,
  limit = 25,
): Promise<VerificationInHistory[]> {
  const { rows } = await tx.query<{
    run_id: string;
    reference: string | null;
    product_code: string;
    at: Date;
    decision: string | null;
    triggered_by: string;
    field_path: string;
    value: unknown;
    previous_value: unknown;
    had_previous: boolean;
  }>(
    `WITH ordered AS (
       SELECT a.id, a.run_id, a.field_path, a.value, a.observed_at, a.created_at,
              lag(a.value) OVER (PARTITION BY a.field_path ORDER BY a.observed_at, a.created_at)
                AS previous_value,
              lag(a.id) OVER (PARTITION BY a.field_path ORDER BY a.observed_at, a.created_at)
                IS NOT NULL AS had_previous
       FROM attestations a
       WHERE a.tenant_id = $1 AND a.entity_id = $2
     )
     SELECT o.run_id, r.reference, r.product_code, r.created_at AS at, r.decision,
            r.triggered_by, o.field_path, o.value, o.previous_value, o.had_previous
     FROM ordered o
     JOIN verification_runs r ON r.tenant_id = $1 AND r.id = o.run_id
     WHERE o.run_id IN (
       SELECT id FROM verification_runs
       WHERE tenant_id = $1 AND entity_id = $2
       ORDER BY created_at DESC
       LIMIT $3
     )
     ORDER BY r.created_at DESC, o.field_path`,
    [tx.tenantId, entityId, limit],
  );

  const byRun = new Map<string, VerificationInHistory>();
  for (const row of rows) {
    let run = byRun.get(row.run_id);
    if (!run) {
      run = {
        runId: row.run_id,
        reference: row.reference,
        productCode: row.product_code,
        at: row.at,
        decision: row.decision,
        triggeredBy: row.triggered_by,
        fields: [],
      };
      byRun.set(row.run_id, run);
    }
    run.fields.push({
      fieldPath: row.field_path,
      value: row.value,
      kind: !row.had_previous
        ? 'new'
        : sameValue(row.value, row.previous_value)
          ? 'confirmed'
          : 'changed',
    });
  }

  return [...byRun.values()];
}

/** Compared as canonical text, so 500000 and "500000" are not reported as a change. */
function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
