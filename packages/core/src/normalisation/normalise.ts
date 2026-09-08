import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { recordAttestation } from '../repositories/attestations.js';
import { resolveEntity } from '../repositories/entities.js';
import { recordChangeEvent, type Severity } from '../monitoring/change-events.js';
import { getFieldMappings, isIdentifierType, type FieldMapping } from './field-map.js';
import { readMatches, resolveReference } from './paths.js';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import type { StepOutcome } from '../orchestration/executor.js';

/**
 * The normalisation layer.
 *
 * ADR-006: a provider payload becomes our attestations, entities and relations through
 * step_field_map, never through code written for a particular product. Our response
 * resembles no provider's response because nothing here passes one through.
 *
 * Three kinds of row come out of a single provider call:
 *
 *   an attestation on the subject, for a mapping with entity_role SUBJECT
 *   a secondary entity plus an attestation on it, for any other role
 *   a relation from the subject to that secondary entity, when relation_type is set
 *
 * That last one is what turns a verification into a network. A manager verified for two
 * different companies resolves to one person, and the relationship query in
 * docs/02-schema.md section 4 finds them without anything extra being stored.
 */

export interface NormaliseInput {
  productCode: string;
  subjectEntityId: string;
  runId: string;
  steps: readonly StepOutcome[];
  observedAt?: Date;
}

export interface NormalisedChange {
  entityId: string;
  fieldPath: string;
  attestationId: string;
  changed: boolean;
  firstObservation: boolean;
}

export interface DetectedChangeEvent {
  changeEventId: string;
  entityId: string;
  fieldPath: string;
  severity: Severity;
  reasonAr: string | null;
}

export interface NormaliseResult {
  attestations: NormalisedChange[];
  /** Secondary entities created or matched, keyed by role. */
  entities: { role: string; entityId: string; created: boolean }[];
  relations: { relationId: string; relType: string; toEntity: string; created: boolean }[];
  /**
   * Changes worth telling someone about.
   *
   * A re-verification returning the same value produces an attestation and no event. That
   * is what keeps an alert meaningful: it fires when something differs, not every time we
   * looked.
   */
  changes: DetectedChangeEvent[];
}

export async function normaliseRun(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  input: NormaliseInput,
): Promise<NormaliseResult> {
  const mappings = await getFieldMappings(tx, input.productCode);
  const byStep = new Map<string, FieldMapping[]>();
  for (const mapping of mappings) {
    const list = byStep.get(mapping.stepKey) ?? [];
    list.push(mapping);
    byStep.set(mapping.stepKey, list);
  }

  const result: NormaliseResult = {
    attestations: [],
    entities: [],
    relations: [],
    changes: [],
  };
  const observedAt = input.observedAt ?? new Date();

  for (const step of input.steps) {
    // Only a step that produced data can produce facts. A SKIPPED or ERROR step
    // contributes nothing, which is why a partial run leaves the previous knowledge for
    // its missing fields untouched rather than overwriting it with emptiness.
    if (step.data === null || (step.status !== 'OK' && step.status !== 'CACHED')) {
      continue;
    }

    for (const mapping of byStep.get(step.stepKey) ?? []) {
      for (const match of readMatches(step.data, mapping.sourcePath)) {
        const entityId =
          mapping.entityRole === 'SUBJECT'
            ? input.subjectEntityId
            : await resolveSecondaryEntity(tx, keys, mapping, step.data, match.element, result);

        const validUntil = readValidUntil(mapping, step.data, match.element);

        const recorded = await recordAttestation(tx, {
          entityId,
          fieldPath: mapping.fieldPath,
          value: match.value,
          // Internal. Rule 5 keeps it out of every public projection.
          source: step.provider,
          authority: step.authority,
          runId: input.runId,
          observedAt,
          validUntil,
          confidence: mapping.confidence,
        });

        result.attestations.push({
          entityId,
          fieldPath: mapping.fieldPath,
          attestationId: recorded.attestationId,
          changed: recorded.changed,
          firstObservation: recorded.firstObservation,
        });

        if (recorded.changed) {
          const event = await recordChangeEvent(tx, {
            entityId,
            fieldPath: mapping.fieldPath,
            oldAttestationId: recorded.previousAttestationId,
            newAttestationId: recorded.attestationId,
            oldValue: recorded.previousValue,
            newValue: match.value,
          });
          if (event) {
            result.changes.push({
              changeEventId: event.changeEventId,
              entityId,
              fieldPath: mapping.fieldPath,
              severity: event.severity,
              reasonAr: event.reasonAr,
            });
          }
        }

        if (mapping.relationType && entityId !== input.subjectEntityId) {
          const relation = await upsertRelation(tx, {
            fromEntity: input.subjectEntityId,
            toEntity: entityId,
            relType: mapping.relationType,
            attestationId: recorded.attestationId,
            validFrom: observedAt,
          });
          result.relations.push({
            relationId: relation.id,
            relType: mapping.relationType,
            toEntity: entityId,
            created: relation.created,
          });
        }
      }
    }
  }

  return result;
}

async function resolveSecondaryEntity(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  mapping: FieldMapping,
  payload: Readonly<Record<string, unknown>>,
  element: Record<string, unknown> | null,
  result: NormaliseResult,
): Promise<string> {
  if (!mapping.identifierPath || !mapping.entityType) {
    // The database constraint prevents this, so reaching it means the constraint was
    // dropped or bypassed.
    throw new NxError('NX-5001', {
      detail: `mapping ${mapping.fieldPath} needs an identifier path and an entity type`,
    });
  }

  const rawIdentifier = resolveReference(mapping.identifierPath, payload, element);
  if (typeof rawIdentifier !== 'string' || rawIdentifier.length === 0) {
    throw new NxError('NX-5001', {
      detail: `mapping ${mapping.fieldPath} found no identifier for its secondary entity`,
    });
  }

  const rawType = mapping.identifierTypeSource
    ? resolveReference(mapping.identifierTypeSource, payload, element)
    : null;
  if (!isIdentifierType(rawType)) {
    // Guessing here would merge two different people whose identifiers share digits.
    throw new NxError('NX-5001', {
      detail: `mapping ${mapping.fieldPath} could not determine the identifier type`,
    });
  }

  const resolved = await resolveEntity(tx, keys, {
    entityType: mapping.entityType,
    identifiers: [{ idType: rawType, value: rawIdentifier }],
  });

  result.entities.push({
    role: mapping.entityRole,
    entityId: resolved.entityId,
    created: resolved.created,
  });
  return resolved.entityId;
}

function readValidUntil(
  mapping: FieldMapping,
  payload: Readonly<Record<string, unknown>>,
  element: Record<string, unknown> | null,
): Date | null {
  if (!mapping.validUntilPath) {
    return null;
  }
  const raw = resolveReference(mapping.validUntilPath, payload, element);
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

interface UpsertRelationInput {
  fromEntity: string;
  toEntity: string;
  relType: string;
  attestationId: string;
  validFrom: Date;
}

/**
 * A relation that already exists is left alone rather than duplicated. Relations are
 * never deleted: when one genuinely ends, ended_at is set and the row stays, so the
 * question "who was the authorised manager in March" keeps its answer.
 */
async function upsertRelation(
  tx: TenantTransaction,
  input: UpsertRelationInput,
): Promise<{ id: string; created: boolean }> {
  const { rows: existing } = await tx.query<{ id: string }>(
    `SELECT id FROM entity_relations
     WHERE tenant_id = $1 AND from_entity = $2 AND to_entity = $3 AND rel_type = $4
       AND ended_at IS NULL`,
    [tx.tenantId, input.fromEntity, input.toEntity, input.relType],
  );

  const found = existing[0]?.id;
  if (found) {
    return { id: found, created: false };
  }

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO entity_relations
       (tenant_id, from_entity, to_entity, rel_type, attestation_id, valid_from)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      tx.tenantId,
      input.fromEntity,
      input.toEntity,
      input.relType,
      input.attestationId,
      input.validFrom,
    ],
  );

  const id = rows[0]?.id;
  if (!id) {
    throw new NxError('NX-5001', { detail: 'relation insert returned no id' });
  }
  return { id, created: true };
}

/** Ends a relation instead of deleting it. */
export async function endRelation(tx: TenantTransaction, relationId: string): Promise<void> {
  await tx.query(
    `UPDATE entity_relations SET ended_at = now()
     WHERE tenant_id = $1 AND id = $2 AND ended_at IS NULL`,
    [tx.tenantId, relationId],
  );
}
