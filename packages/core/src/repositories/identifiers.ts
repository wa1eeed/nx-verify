import { withSavepoint, type TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import {
  decryptIdentifier,
  hashIdentifier,
  maskIdentifier,
  protectIdentifier,
  type IdentifierType,
} from '../crypto/identifier.js';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';

export interface AttachIdentifierInput {
  entityId: string;
  idType: IdentifierType;
  value: string;
  isPrimary?: boolean;
}

export interface AttachedIdentifier {
  id: string;
  entityId: string;
  idType: IdentifierType;
  isPrimary: boolean;
  /** True when the identifier was already attached to this entity. */
  alreadyPresent: boolean;
}

const UNIQUE_VIOLATION = '23505';

/**
 * Attaching an identifier is idempotent for the same entity and refused for a different
 * one. That refusal is what stops one national id from being claimed by two entities in
 * the same tenant, which would break identity resolution in a way that is very hard to
 * unpick later.
 */
export async function attachIdentifier(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  input: AttachIdentifierInput,
): Promise<AttachedIdentifier> {
  const protectedValue = await protectIdentifier(keys, tx.tenantId, input.idType, input.value);
  const isPrimary = input.isPrimary ?? false;

  try {
    // The insert is the conflict detector, so it needs a savepoint. Selecting first and
    // inserting second would race two concurrent callers into the same violation anyway.
    const rows = await withSavepoint(tx, async () => {
      const result = await tx.query<{ id: string }>(
        `INSERT INTO entity_identifiers
           (tenant_id, entity_id, id_type, id_value_hash, id_value_enc, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          tx.tenantId,
          input.entityId,
          input.idType,
          protectedValue.hash,
          protectedValue.encrypted,
          isPrimary,
        ],
      );
      return result.rows;
    });
    const id = rows[0]?.id;
    if (!id) {
      throw new NxError('NX-5001', { detail: 'identifier insert returned no id' });
    }
    return { id, entityId: input.entityId, idType: input.idType, isPrimary, alreadyPresent: false };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const { rows } = await tx.query<{ id: string; entity_id: string; is_primary: boolean }>(
      `SELECT id, entity_id, is_primary
       FROM entity_identifiers
       WHERE tenant_id = $1 AND id_type = $2 AND id_value_hash = $3`,
      [tx.tenantId, input.idType, protectedValue.hash],
    );
    const existing = rows[0];
    if (!existing) {
      // The conflict was on the single primary identifier index, not on the value.
      throw new NxError('NX-4091', {
        detail: 'entity already has a primary identifier',
        cause: error,
      });
    }
    if (existing.entity_id !== input.entityId) {
      // The value is deliberately absent from the message. Rule 4.
      throw new NxError('NX-4091', {
        detail: `identifier of type ${input.idType} belongs to another entity`,
        cause: error,
      });
    }
    return {
      id: existing.id,
      entityId: existing.entity_id,
      idType: input.idType,
      isPrimary: existing.is_primary,
      alreadyPresent: true,
    };
  }
}

/** The lookup half of identity resolution. Returns null when nothing matches. */
export async function findEntityIdByIdentifier(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  idType: IdentifierType,
  value: string,
): Promise<string | null> {
  const hmacKey = await keys.hmacKey(tx.tenantId);
  const hash = hashIdentifier(hmacKey, idType, value);

  const { rows } = await tx.query<{ entity_id: string }>(
    `SELECT entity_id
     FROM entity_identifiers
     WHERE tenant_id = $1 AND id_type = $2 AND id_value_hash = $3`,
    [tx.tenantId, idType, hash],
  );
  return rows[0]?.entity_id ?? null;
}

export interface RevealedIdentifier {
  id: string;
  idType: IdentifierType;
  isPrimary: boolean;
  /** Masked for display. The full value is only produced on explicit request. */
  masked: string;
}

export async function listIdentifiers(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  entityId: string,
): Promise<RevealedIdentifier[]> {
  const encryptionKey = await keys.encryptionKey(tx.tenantId);
  const { rows } = await tx.query<{
    id: string;
    id_type: IdentifierType;
    id_value_enc: Buffer;
    is_primary: boolean;
  }>(
    `SELECT id, id_type, id_value_enc, is_primary
     FROM entity_identifiers
     WHERE tenant_id = $1 AND entity_id = $2
     ORDER BY is_primary DESC, id_type`,
    [tx.tenantId, entityId],
  );

  return rows.map((row) => ({
    id: row.id,
    idType: row.id_type,
    isPrimary: row.is_primary,
    masked: maskIdentifier(decryptIdentifier(encryptionKey, row.id_value_enc)),
  }));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/**
 * Decrypts one identifier, for an outbound call to an authority.
 *
 * This is the only function in the system that returns an identifier in the clear, and it
 * exists because a re-verification has to send the authority the number it is asking
 * about. It is for provider calls, never for display, never for a log line, and never for
 * a response body. Everything user facing goes through listIdentifiers, which masks.
 */
export async function revealIdentifier(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  entityId: string,
  idTypes: readonly IdentifierType[],
): Promise<{ idType: IdentifierType; value: string } | null> {
  const encryptionKey = await keys.encryptionKey(tx.tenantId);

  const { rows } = await tx.query<{ id_type: IdentifierType; id_value_enc: Buffer }>(
    `SELECT id_type, id_value_enc
     FROM entity_identifiers
     WHERE tenant_id = $1 AND entity_id = $2 AND id_type = ANY($3::text[])
     ORDER BY is_primary DESC, array_position($3::text[], id_type)
     LIMIT 1`,
    [tx.tenantId, entityId, [...idTypes]],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }
  return { idType: row.id_type, value: decryptIdentifier(encryptionKey, row.id_value_enc) };
}
