import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { NxError } from '../errors.js';
import type { TenantKeyProvider } from './tenant-keys.js';

/**
 * Identifier protection.
 *
 * Rule 4: an identifier is stored as a keyed hash for lookup and encrypted for display,
 * never as text, and it never appears in a log line, an error message or a backup.
 *
 * Note what is absent from this file: no function takes an identifier and returns it in
 * an error string, and no branch interpolates a value into a message. That is deliberate.
 * Most plaintext leaks arrive through error paths, not storage.
 */

export type IdentifierType =
  'CR' | 'UNN' | 'NATIONAL_ID' | 'IQAMA' | 'FREELANCE_DOC' | 'IBAN' | 'REAL_ESTATE_NO';

const DIGITS_ONLY: ReadonlySet<IdentifierType> = new Set<IdentifierType>([
  'CR',
  'UNN',
  'NATIONAL_ID',
  'IQAMA',
]);

/**
 * The same identifier written two ways must hash identically, otherwise identity
 * resolution silently creates duplicate entities and the whole model degrades.
 */
export function normalizeIdentifier(idType: IdentifierType, value: string): string {
  const stripped = value.replace(/[\s-]/g, '');
  const normalized = DIGITS_ONLY.has(idType)
    ? stripped.replace(/[^0-9]/g, '')
    : stripped.toUpperCase();

  if (normalized.length === 0) {
    throw new NxError('NX-4001', { detail: `identifier of type ${idType} is empty` });
  }
  return normalized;
}

/**
 * Keyed with a per tenant key, so the same national id hashes differently for every
 * tenant. Correlating a person across tenants is impossible from the table alone.
 * The type is part of the input so that a CR and an IQAMA sharing digits never collide.
 */
export function hashIdentifier(key: Buffer, idType: IdentifierType, value: string): Buffer {
  const normalized = normalizeIdentifier(idType, value);
  return createHmac('sha256', key).update(`${idType}:${normalized}`, 'utf8').digest();
}

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Layout: version(1) || iv(12) || tag(16) || ciphertext. AES-256-GCM. */
export function encryptIdentifier(key: Buffer, idType: IdentifierType, value: string): Buffer {
  const normalized = normalizeIdentifier(idType, value);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.of(VERSION), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptIdentifier(key: Buffer, payload: Buffer): string {
  if (payload.length < 1 + IV_BYTES + TAG_BYTES || payload[0] !== VERSION) {
    throw new NxError('NX-5001', { detail: 'identifier ciphertext is malformed' });
  }
  const iv = payload.subarray(1, 1 + IV_BYTES);
  const tag = payload.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function identifiersMatch(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface ProtectedIdentifier {
  idType: IdentifierType;
  hash: Buffer;
  encrypted: Buffer;
}

export async function protectIdentifier(
  keys: TenantKeyProvider,
  tenantId: string,
  idType: IdentifierType,
  value: string,
): Promise<ProtectedIdentifier> {
  const [hmacKey, encryptionKey] = await Promise.all([
    keys.hmacKey(tenantId),
    keys.encryptionKey(tenantId),
  ]);
  return {
    idType,
    hash: hashIdentifier(hmacKey, idType, value),
    encrypted: encryptIdentifier(encryptionKey, idType, value),
  };
}

/** Display only. Masks all but the last four characters, as the console shows them. */
export function maskIdentifier(value: string): string {
  if (value.length <= 4) {
    return '•'.repeat(value.length);
  }
  return `${'•'.repeat(value.length - 4)}${value.slice(-4)}`;
}
