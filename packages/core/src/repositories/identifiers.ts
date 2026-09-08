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
  /** Which key version produced the stored hash and ciphertext. */
  keyVersion: number;
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
  const keyVersion = await keys.currentVersion();
  const isPrimary = input.isPrimary ?? false;

  // Look under every readable key version before inserting anything.
  //
  // During a rotation the same identifier may already be stored under an older key with a
  // different hash. Inserting without this check would not raise a conflict, because the
  // new hash is genuinely absent, and the table would end up holding the same identifier
  // twice under two hashes. The rotation job would then try to give both rows the same
  // hash and hit the unique index.
  const existing = await findExistingRow(tx, keys, input.idType, input.value, keyVersion);

  if (existing) {
    if (existing.entityId !== input.entityId) {
      // The value is deliberately absent from the message. Rule 4.
      throw new NxError('NX-4091', {
        detail: `identifier of type ${input.idType} belongs to another entity`,
      });
    }

    if (existing.keyVersion !== keyVersion) {
      // Seen during a rotation, so move it across now. Rows rotate as they are touched,
      // and the job handles whatever is never touched.
      const protectedValue = await protectIdentifier(keys, tx.tenantId, input.idType, input.value);
      await tx.query(
        `UPDATE entity_identifiers
         SET id_value_hash = $3, id_value_enc = $4, key_version = $5
         WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, existing.id, protectedValue.hash, protectedValue.encrypted, keyVersion],
      );
    }

    return {
      id: existing.id,
      entityId: existing.entityId,
      idType: input.idType,
      isPrimary: existing.isPrimary,
      alreadyPresent: true,
      keyVersion,
    };
  }

  const protectedValue = await protectIdentifier(keys, tx.tenantId, input.idType, input.value);

  try {
    // The insert is still the final arbiter, because two callers can pass the check above
    // at the same moment. It needs a savepoint: a failed statement aborts the whole
    // transaction, so the recovery below would otherwise run against an aborted one.
    const rows = await withSavepoint(tx, async () => {
      const result = await tx.query<{ id: string }>(
        `INSERT INTO entity_identifiers
           (tenant_id, entity_id, id_type, id_value_hash, id_value_enc, is_primary, key_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          tx.tenantId,
          input.entityId,
          input.idType,
          protectedValue.hash,
          protectedValue.encrypted,
          isPrimary,
          keyVersion,
        ],
      );
      return result.rows;
    });

    const id = rows[0]?.id;
    if (!id) {
      throw new NxError('NX-5001', { detail: 'identifier insert returned no id' });
    }
    return {
      id,
      entityId: input.entityId,
      idType: input.idType,
      isPrimary,
      alreadyPresent: false,
      keyVersion,
    };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const raced = await findExistingRow(tx, keys, input.idType, input.value, keyVersion);
    if (!raced) {
      // The conflict was on the single primary identifier index, not on the value.
      throw new NxError('NX-4091', {
        detail: 'entity already has a primary identifier',
        cause: error,
      });
    }
    if (raced.entityId !== input.entityId) {
      throw new NxError('NX-4091', {
        detail: `identifier of type ${input.idType} belongs to another entity`,
        cause: error,
      });
    }
    return {
      id: raced.id,
      entityId: raced.entityId,
      idType: input.idType,
      isPrimary: raced.isPrimary,
      alreadyPresent: true,
      keyVersion: raced.keyVersion,
    };
  }
}

interface ExistingIdentifier {
  id: string;
  entityId: string;
  isPrimary: boolean;
  keyVersion: number;
}

/** Finds a stored identifier under any key version that is still readable. */
async function findExistingRow(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  idType: IdentifierType,
  value: string,
  currentVersion: number,
): Promise<ExistingIdentifier | null> {
  const versions = [
    currentVersion,
    ...(await keys.availableVersions()).filter((version) => version !== currentVersion),
  ];

  for (const version of versions) {
    const hmacKey = await keys.hmacKey(tx.tenantId, version);
    const hash = hashIdentifier(hmacKey, idType, value);

    const { rows } = await tx.query<{
      id: string;
      entity_id: string;
      is_primary: boolean;
      key_version: number;
    }>(
      `SELECT id, entity_id, is_primary, key_version
       FROM entity_identifiers
       WHERE tenant_id = $1 AND id_type = $2 AND id_value_hash = $3`,
      [tx.tenantId, idType, hash],
    );

    const row = rows[0];
    if (row) {
      return {
        id: row.id,
        entityId: row.entity_id,
        isPrimary: row.is_primary,
        keyVersion: row.key_version,
      };
    }
  }

  return null;
}

/**
 * The lookup half of identity resolution.
 *
 * Tries the current key first, then every older version that is still readable. During a
 * rotation the same identifier may be stored under either, and a lookup that only tried
 * the current one would create a duplicate entity for a company already known. That is
 * the failure this whole versioning scheme exists to prevent.
 */
export async function findEntityIdByIdentifier(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  idType: IdentifierType,
  value: string,
): Promise<string | null> {
  const current = await keys.currentVersion();
  const versions = [current, ...(await keys.availableVersions()).filter((v) => v !== current)];

  for (const version of versions) {
    const hmacKey = await keys.hmacKey(tx.tenantId, version);
    const hash = hashIdentifier(hmacKey, idType, value);

    const { rows } = await tx.query<{ entity_id: string }>(
      `SELECT entity_id
       FROM entity_identifiers
       WHERE tenant_id = $1 AND id_type = $2 AND id_value_hash = $3`,
      [tx.tenantId, idType, hash],
    );

    const found = rows[0]?.entity_id;
    if (found) {
      return found;
    }
  }

  return null;
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
  const { rows } = await tx.query<{
    id: string;
    id_type: IdentifierType;
    id_value_enc: Buffer;
    is_primary: boolean;
    key_version: number;
  }>(
    `SELECT id, id_type, id_value_enc, is_primary, key_version
     FROM entity_identifiers
     WHERE tenant_id = $1 AND entity_id = $2
     ORDER BY is_primary DESC, id_type`,
    [tx.tenantId, entityId],
  );

  const revealed: RevealedIdentifier[] = [];
  for (const row of rows) {
    // Each row is decrypted with the key that encrypted it, which is what lets a
    // rotation run in the background instead of all at once.
    const encryptionKey = await keys.encryptionKey(tx.tenantId, row.key_version);
    revealed.push({
      id: row.id,
      idType: row.id_type,
      isPrimary: row.is_primary,
      masked: maskIdentifier(decryptIdentifier(encryptionKey, row.id_value_enc)),
    });
  }
  return revealed;
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
  const { rows } = await tx.query<{
    id_type: IdentifierType;
    id_value_enc: Buffer;
    key_version: number;
  }>(
    `SELECT id_type, id_value_enc, key_version
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
  const encryptionKey = await keys.encryptionKey(tx.tenantId, row.key_version);
  return { idType: row.id_type, value: decryptIdentifier(encryptionKey, row.id_value_enc) };
}
