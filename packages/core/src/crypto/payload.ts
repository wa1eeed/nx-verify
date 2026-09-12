import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { NxError } from '../errors.js';

/**
 * Encryption for a whole document rather than a single identifier.
 *
 * `encryptIdentifier` normalises before it encrypts, which is right for an identifier and
 * wrong for anything else: normalising a document would change it. This keeps the same
 * layout and the same key, and normalises nothing.
 *
 * Rule 4 allows an identifier at rest encrypted and in no other form. A verification
 * subject is mostly identifiers, so anything that stores one stores it through here.
 */

const VERSION = 2;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Layout: version(1) || iv(12) || tag(16) || ciphertext. AES-256-GCM. */
export function encryptJson(key: Buffer, value: unknown): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(value ?? null);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.of(VERSION), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptJson<T>(key: Buffer, payload: Buffer): T {
  if (payload.length < 1 + IV_BYTES + TAG_BYTES || payload[0] !== VERSION) {
    // Says that it is malformed and never what it contained.
    throw new NxError('NX-5001', { detail: 'stored payload is malformed' });
  }
  const iv = payload.subarray(1, 1 + IV_BYTES);
  const tag = payload.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext) as T;
}
