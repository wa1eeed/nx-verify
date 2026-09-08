import type { TenantTransaction } from '@nx-verify/db';

/**
 * The relationship queries from docs/02-schema.md section 4.
 *
 * These are the reports that sell the platform: one person authorised to sign for seven
 * companies, one IBAN behind three entities with different names, one national address
 * shared by five businesses registered in the same week.
 *
 * Rule 2 in its sharpest form: every one of these is scoped to a single tenant. There is
 * no cross tenant version of this query and there must never be one, in code or in a
 * report. It is a contractual limit as much as a technical one.
 */

export interface EntityLink {
  entityId: string;
  displayName: string | null;
  entityType: string;
  linkedCount: number;
}

export async function findEntitiesLinkedToMany(
  tx: TenantTransaction,
  relType: string,
  threshold = 3,
): Promise<EntityLink[]> {
  const { rows } = await tx.query<{
    entity_id: string;
    display_name: string | null;
    entity_type: string;
    linked_count: string;
  }>(
    `SELECT p.id AS entity_id,
            p.display_name,
            p.entity_type,
            count(DISTINCT r.from_entity)::text AS linked_count
     FROM entity_relations r
     JOIN entities p ON p.tenant_id = r.tenant_id AND p.id = r.to_entity
     WHERE r.tenant_id = $1
       AND r.rel_type = $2
       AND r.ended_at IS NULL
     GROUP BY p.id, p.display_name, p.entity_type
     HAVING count(DISTINCT r.from_entity) >= $3
     ORDER BY count(DISTINCT r.from_entity) DESC`,
    [tx.tenantId, relType, threshold],
  );

  return rows.map((row) => ({
    entityId: row.entity_id,
    displayName: row.display_name,
    entityType: row.entity_type,
    linkedCount: Number(row.linked_count),
  }));
}

export interface RelationEdge {
  relationId: string;
  relType: string;
  fromEntity: string;
  toEntity: string;
  attestationId: string;
  validFrom: Date;
  endedAt: Date | null;
}

export async function getRelations(
  tx: TenantTransaction,
  entityId: string,
  options: { includeEnded?: boolean } = {},
): Promise<RelationEdge[]> {
  const { rows } = await tx.query<{
    id: string;
    rel_type: string;
    from_entity: string;
    to_entity: string;
    attestation_id: string;
    valid_from: Date;
    ended_at: Date | null;
  }>(
    `SELECT id, rel_type, from_entity, to_entity, attestation_id, valid_from, ended_at
     FROM entity_relations
     WHERE tenant_id = $1
       AND (from_entity = $2 OR to_entity = $2)
       AND ($3::boolean OR ended_at IS NULL)
     ORDER BY valid_from DESC`,
    [tx.tenantId, entityId, options.includeEnded ?? false],
  );

  return rows.map((row) => ({
    relationId: row.id,
    relType: row.rel_type,
    fromEntity: row.from_entity,
    toEntity: row.to_entity,
    attestationId: row.attestation_id,
    validFrom: row.valid_from,
    endedAt: row.ended_at,
  }));
}
