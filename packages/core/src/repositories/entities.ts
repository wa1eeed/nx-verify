import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { attachIdentifier, findEntityIdByIdentifier } from './identifiers.js';
import type { IdentifierType } from '../crypto/identifier.js';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';

/**
 * Identity resolution.
 *
 * The rule from docs/02-schema.md section 2: an identifier that matches an existing
 * entity for the same tenant is merged into it, and an entity is created only when
 * nothing matches. This is what stops the same company appearing ten times.
 *
 * Entity types are shared across every product (ADR-002). A freelance certificate is not
 * a table, it is entity_type = FREELANCER.
 */

export type EntityType = 'BUSINESS' | 'PERSON' | 'FREELANCER' | 'BANK_ACCOUNT' | 'PROPERTY';

export interface IdentifierInput {
  idType: IdentifierType;
  value: string;
  isPrimary?: boolean;
}

export interface ResolveEntityInput {
  entityType: EntityType;
  identifiers: IdentifierInput[];
  displayName?: string | undefined;
}

export interface ResolvedEntity {
  entityId: string;
  created: boolean;
  /** Which identifier matched an existing entity, or null when one was created. */
  matchedBy: IdentifierType | null;
}

export async function resolveEntity(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  input: ResolveEntityInput,
): Promise<ResolvedEntity> {
  if (input.identifiers.length === 0) {
    throw new NxError('NX-4001', { detail: 'at least one identifier is required' });
  }

  const matches = new Map<string, IdentifierType>();
  for (const identifier of input.identifiers) {
    const existing = await findEntityIdByIdentifier(tx, keys, identifier.idType, identifier.value);
    if (existing && !matches.has(existing)) {
      matches.set(existing, identifier.idType);
    }
  }

  if (matches.size > 1) {
    // Merging two entities rewrites history, and history here is the product. A human
    // decides, so this surfaces as a conflict rather than a silent merge.
    throw new NxError('NX-4091', {
      detail: 'the supplied identifiers already belong to different entities',
    });
  }

  const [matched] = [...matches.entries()];
  const entityId = matched ? matched[0] : await createEntity(tx, input);

  for (const identifier of input.identifiers) {
    await attachIdentifier(tx, keys, {
      entityId,
      idType: identifier.idType,
      value: identifier.value,
      ...(identifier.isPrimary === undefined ? {} : { isPrimary: identifier.isPrimary }),
    });
  }

  if (matched) {
    await tx.query(
      `UPDATE entities
       SET last_seen_at = now(),
           display_name = COALESCE($3, display_name)
       WHERE tenant_id = $1 AND id = $2`,
      [tx.tenantId, entityId, input.displayName ?? null],
    );
  }

  return {
    entityId,
    created: matched === undefined,
    matchedBy: matched ? matched[1] : null,
  };
}

async function createEntity(tx: TenantTransaction, input: ResolveEntityInput): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO entities (tenant_id, entity_type, display_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [tx.tenantId, input.entityType, input.displayName ?? null],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new NxError('NX-5001', { detail: 'entity insert returned no id' });
  }
  return id;
}

export interface EntitySummary {
  entityId: string;
  entityType: EntityType;
  displayName: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  archivedAt: Date | null;
}

export async function getEntity(
  tx: TenantTransaction,
  entityId: string,
): Promise<EntitySummary | null> {
  const { rows } = await tx.query<{
    id: string;
    entity_type: EntityType;
    display_name: string | null;
    first_seen_at: Date;
    last_seen_at: Date;
    archived_at: Date | null;
  }>(
    `SELECT id, entity_type, display_name, first_seen_at, last_seen_at, archived_at
     FROM entities
     WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, entityId],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    entityId: row.id,
    entityType: row.entity_type,
    displayName: row.display_name,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    archivedAt: row.archived_at,
  };
}
