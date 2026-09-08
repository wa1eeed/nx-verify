import type { TenantTransaction } from '@nx-verify/db';
import type { EntityType } from '../repositories/entities.js';
import type { IdentifierType } from '../crypto/identifier.js';

export type EntityRole = 'SUBJECT' | 'MANAGER' | 'OWNER' | 'ACCOUNT_HOLDER' | 'PROPERTY_OWNER';
export type RelationType =
  'MANAGES' | 'OWNS' | 'HOLDS_ACCOUNT' | 'OWNS_PROPERTY' | 'SHARES_ADDRESS';

export interface FieldMapping {
  productCode: string;
  stepKey: string;
  sourcePath: string;
  fieldPath: string;
  entityRole: EntityRole;
  entityType: EntityType | null;
  identifierPath: string | null;
  identifierTypeSource: string | null;
  relationType: RelationType | null;
  validUntilPath: string | null;
  confidence: number;
}

export async function getFieldMappings(
  tx: TenantTransaction,
  productCode: string,
): Promise<FieldMapping[]> {
  const { rows } = await tx.query<{
    product_code: string;
    step_key: string;
    source_path: string;
    field_path: string;
    entity_role: EntityRole;
    entity_type: EntityType | null;
    identifier_path: string | null;
    identifier_type_source: string | null;
    relation_type: RelationType | null;
    valid_until_path: string | null;
    confidence: string;
  }>(
    `SELECT product_code, step_key, source_path, field_path, entity_role, entity_type,
            identifier_path, identifier_type_source, relation_type, valid_until_path, confidence
     FROM step_field_map
     WHERE product_code = $1
     ORDER BY step_key, source_path`,
    [productCode],
  );

  return rows.map((row) => ({
    productCode: row.product_code,
    stepKey: row.step_key,
    sourcePath: row.source_path,
    fieldPath: row.field_path,
    entityRole: row.entity_role,
    entityType: row.entity_type,
    identifierPath: row.identifier_path,
    identifierTypeSource: row.identifier_type_source,
    relationType: row.relation_type,
    validUntilPath: row.valid_until_path,
    confidence: Number(row.confidence),
  }));
}

export function isIdentifierType(value: unknown): value is IdentifierType {
  return (
    typeof value === 'string' &&
    ['CR', 'UNN', 'NATIONAL_ID', 'IQAMA', 'FREELANCE_DOC', 'IBAN', 'REAL_ESTATE_NO'].includes(value)
  );
}
