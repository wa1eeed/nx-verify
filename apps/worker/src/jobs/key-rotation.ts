import {
  audit,
  decryptIdentifier,
  encryptIdentifier,
  hashIdentifier,
  type IdentifierType,
  type TenantKeyProvider,
} from '@nx-verify/core';
import type { TenantTransaction } from '@nx-verify/db';

/**
 * Moving stored identifiers onto the current key.
 *
 * docs/01-blueprint.md promises key rotation every ninety days. What makes that hard here
 * is that the identifier hash is the lookup index: change the key and every hash stops
 * matching, so identity resolution would create a second entity for every company already
 * known. That is why nothing rotates until each row records the version that produced it.
 *
 * The job decrypts a row with its own key, re-encrypts and re-hashes with the current one,
 * and writes both back with the new version. It works in batches and is safe to stop and
 * resume: a row is either fully on the old key or fully on the new one, never between.
 *
 * What it does not touch is evidence. Re-signing a seal would change a hash a customer has
 * already shown to an auditor, so old evidence keeps its old key and stays verifiable for
 * as long as that key is readable.
 */

export interface RotationOptions {
  keys: TenantKeyProvider;
  /** Rows per run. Rotation is background work and should not hold a long transaction. */
  batchSize?: number;
  actorId?: string;
}

export interface RotationSummary {
  targetVersion: number;
  rotated: number;
  remaining: number;
}

export async function rotateIdentifierKeys(
  tx: TenantTransaction,
  options: RotationOptions,
): Promise<RotationSummary> {
  const target = await options.keys.currentVersion();
  const batchSize = options.batchSize ?? 500;

  const { rows } = await tx.query<{
    id: string;
    id_type: IdentifierType;
    id_value_enc: Buffer;
    key_version: number;
  }>(
    `SELECT id, id_type, id_value_enc, key_version
     FROM entity_identifiers
     WHERE tenant_id = $1 AND key_version <> $2
     ORDER BY key_version, id
     LIMIT $3
     FOR UPDATE SKIP LOCKED`,
    [tx.tenantId, target, batchSize],
  );

  const newHmacKey = await options.keys.hmacKey(tx.tenantId, target);
  const newEncryptionKey = await options.keys.encryptionKey(tx.tenantId, target);

  let rotated = 0;

  for (const row of rows) {
    const oldEncryptionKey = await options.keys.encryptionKey(tx.tenantId, row.key_version);

    // The plaintext exists in memory for the length of this loop iteration and is never
    // written, logged or returned. That is the whole cost of rotation.
    const value = decryptIdentifier(oldEncryptionKey, row.id_value_enc);

    await tx.query(
      `UPDATE entity_identifiers
       SET id_value_hash = $3, id_value_enc = $4, key_version = $5
       WHERE tenant_id = $1 AND id = $2`,
      [
        tx.tenantId,
        row.id,
        hashIdentifier(newHmacKey, row.id_type, value),
        encryptIdentifier(newEncryptionKey, row.id_type, value),
        target,
      ],
    );
    rotated += 1;
  }

  rotated += await rotateSealedRequests(tx, options.keys, target, batchSize);

  const { rows: left } = await tx.query<{ remaining: string }>(
    `SELECT ((SELECT count(*) FROM entity_identifiers
              WHERE tenant_id = $1 AND key_version <> $2)
           + (SELECT count(*) FROM verification_requests
              WHERE tenant_id = $1 AND key_version <> $2 AND ${SEALED}))::text AS remaining`,
    [tx.tenantId, target],
  );

  const remaining = Number(left[0]?.remaining ?? 0);

  if (rotated > 0) {
    await audit(tx, {
      actorType: 'SYSTEM',
      actorId: options.actorId ?? 'key-rotation-job',
      action: 'keys.rotated',
      metadata: { target_version: target, rotated, remaining },
    });
  }

  return { targetVersion: target, rotated, remaining };
}

/** A verification request still holding something typed, sealed. */
const SEALED = `(subject_enc IS NOT NULL OR certificate_enc IS NOT NULL OR iban_enc IS NOT NULL)`;

/**
 * Moves what a waiting verification request holds onto the current key.
 *
 * A draft keeps the number somebody typed for up to ninety days, sealed under the key of the
 * day it was typed. Left behind, it would keep an old key alive, or be lost with it. The
 * subject's hash is the lookup of a request by its customer, so it is rebuilt with the
 * ciphertext, in the same statement.
 */
async function rotateSealedRequests(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  target: number,
  batchSize: number,
): Promise<number> {
  const { rows } = await tx.query<{
    id: string;
    subject_type: IdentifierType | null;
    subject_enc: Buffer | null;
    certificate_enc: Buffer | null;
    iban_enc: Buffer | null;
    key_version: number;
  }>(
    `SELECT id, subject_type, subject_enc, certificate_enc, iban_enc, key_version
     FROM verification_requests
     WHERE tenant_id = $1 AND key_version <> $2 AND ${SEALED}
     ORDER BY key_version, id
     LIMIT $3
     FOR UPDATE SKIP LOCKED`,
    [tx.tenantId, target, batchSize],
  );

  const newHmacKey = await keys.hmacKey(tx.tenantId, target);
  const newEncryptionKey = await keys.encryptionKey(tx.tenantId, target);

  for (const row of rows) {
    const oldEncryptionKey = await keys.encryptionKey(tx.tenantId, row.key_version);
    const reseal = (idType: IdentifierType, payload: Buffer | null): Buffer | null =>
      payload === null
        ? null
        : encryptIdentifier(newEncryptionKey, idType, decryptIdentifier(oldEncryptionKey, payload));
    const subject =
      row.subject_enc === null || row.subject_type === null
        ? null
        : decryptIdentifier(oldEncryptionKey, row.subject_enc);

    await tx.query(
      `UPDATE verification_requests
       SET subject_hash = $3, subject_enc = $4, certificate_enc = $5, iban_enc = $6,
           key_version = $7
       WHERE tenant_id = $1 AND id = $2`,
      [
        tx.tenantId,
        row.id,
        subject === null
          ? null
          : hashIdentifier(newHmacKey, row.subject_type as IdentifierType, subject),
        subject === null
          ? null
          : encryptIdentifier(newEncryptionKey, row.subject_type as IdentifierType, subject),
        reseal('FREELANCE_DOC', row.certificate_enc),
        reseal('IBAN', row.iban_enc),
        target,
      ],
    );
  }
  return rows.length;
}

/**
 * Whether an old key can be discarded yet.
 *
 * A version may only be retired once nothing still reads it. Identifiers move with the
 * job above; evidence never moves, so a version that signed any seal stays readable for
 * as long as that seal is meant to be verifiable. Discarding it early would silently turn
 * a customer's audit document into one that cannot be checked.
 */
export interface RetirementCheck {
  version: number;
  identifiersRemaining: number;
  /** Verification requests still holding something typed under this version. */
  requestsRemaining: number;
  evidenceSealed: number;
  safeToRetire: boolean;
}

export async function canRetireKeyVersion(
  tx: TenantTransaction,
  version: number,
): Promise<RetirementCheck> {
  const { rows } = await tx.query<{ identifiers: string; requests: string; evidence: string }>(
    `SELECT
       (SELECT count(*) FROM entity_identifiers
        WHERE tenant_id = $1 AND key_version = $2)::text AS identifiers,
       (SELECT count(*) FROM verification_requests
        WHERE tenant_id = $1 AND key_version = $2 AND ${SEALED})::text AS requests,
       (SELECT count(*) FROM evidence
        WHERE tenant_id = $1 AND key_version = $2)::text AS evidence`,
    [tx.tenantId, version],
  );

  const identifiersRemaining = Number(rows[0]?.identifiers ?? 0);
  const requestsRemaining = Number(rows[0]?.requests ?? 0);
  const evidenceSealed = Number(rows[0]?.evidence ?? 0);

  return {
    version,
    identifiersRemaining,
    requestsRemaining,
    evidenceSealed,
    safeToRetire: identifiersRemaining === 0 && requestsRemaining === 0 && evidenceSealed === 0,
  };
}
