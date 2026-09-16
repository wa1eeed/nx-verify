import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { NxError } from '../errors.js';

/**
 * Sealing a secret of our own with a key derived from the master key.
 *
 * The identifier envelope (crypto/identifier.ts) normalises what it seals, because two spellings
 * of one number must hash alike. A secret is bytes and must come back exactly as it went in, so
 * it gets the same envelope without the normalising: version, nonce, tag, ciphertext, AES-256-GCM.
 *
 * Used for the panel's one time password secrets (SEC-02). No key is stored beside the value
 * (rule 10): the key is derived from the deployment's master key when it is needed.
 */

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Layout: version(1) || iv(12) || tag(16) || ciphertext. */
export function sealSecret(key: Buffer, value: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.of(VERSION), iv, cipher.getAuthTag(), ciphertext]);
}

export function openSecret(key: Buffer, payload: Buffer): string {
  if (payload.length < 1 + IV_BYTES + TAG_BYTES || payload[0] !== VERSION) {
    throw new NxError('NX-5001', { detail: 'sealed secret is malformed' });
  }
  const iv = payload.subarray(1, 1 + IV_BYTES);
  const tag = payload.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
