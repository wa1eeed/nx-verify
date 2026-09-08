import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  decryptIdentifier,
  encryptIdentifier,
  hashIdentifier,
  maskIdentifier,
  normalizeIdentifier,
} from '../src/crypto/identifier.js';
import { DerivedTenantKeyProvider } from '../src/crypto/tenant-keys.js';
import { StaticMasterKeySource } from '../src/crypto/master-key.js';

const keys = new DerivedTenantKeyProvider(new StaticMasterKeySource(Buffer.alloc(32, 7)));

describe('identifier protection', () => {
  it('normalises formatting variants to one value', () => {
    expect(normalizeIdentifier('NATIONAL_ID', '1098 765 432')).toBe('1098765432');
    expect(normalizeIdentifier('IBAN', 'sa03 8000-0000')).toBe('SA0380000000');
  });

  it('gives the same hash for the same identifier and tenant', async () => {
    const tenantId = randomUUID();
    const key = await keys.hmacKey(tenantId);
    expect(hashIdentifier(key, 'CR', '1010478213')).toEqual(
      hashIdentifier(key, 'CR', '1010-478-213'),
    );
  });

  it('gives a different hash for the same digits under a different type', async () => {
    const key = await keys.hmacKey(randomUUID());
    expect(hashIdentifier(key, 'CR', '1010478213')).not.toEqual(
      hashIdentifier(key, 'NATIONAL_ID', '1010478213'),
    );
  });

  it('gives a different hash per tenant', async () => {
    const [first, second] = await Promise.all([
      keys.hmacKey(randomUUID()),
      keys.hmacKey(randomUUID()),
    ]);
    expect(hashIdentifier(first, 'CR', '1010478213')).not.toEqual(
      hashIdentifier(second, 'CR', '1010478213'),
    );
  });

  it('derives distinct keys for hashing and for encryption', async () => {
    const tenantId = randomUUID();
    const [hmac, encryption] = await Promise.all([
      keys.hmacKey(tenantId),
      keys.encryptionKey(tenantId),
    ]);
    expect(hmac.equals(encryption)).toBe(false);
  });

  it('round trips through encryption without leaking the value in the ciphertext', async () => {
    const key = await keys.encryptionKey(randomUUID());
    const payload = encryptIdentifier(key, 'NATIONAL_ID', '1098765432');
    expect(payload.toString('utf8')).not.toContain('1098765432');
    expect(decryptIdentifier(key, payload)).toBe('1098765432');
  });

  it('produces a different ciphertext each time for the same value', async () => {
    const key = await keys.encryptionKey(randomUUID());
    const first = encryptIdentifier(key, 'CR', '1010478213');
    const second = encryptIdentifier(key, 'CR', '1010478213');
    expect(first.equals(second)).toBe(false);
  });

  it('refuses a tampered ciphertext', async () => {
    const key = await keys.encryptionKey(randomUUID());
    const payload = encryptIdentifier(key, 'CR', '1010478213');
    payload.writeUInt8(payload.readUInt8(payload.length - 1) ^ 0xff, payload.length - 1);
    expect(() => decryptIdentifier(key, payload)).toThrow();
  });

  it('masks all but the last four characters', () => {
    expect(maskIdentifier('1098765432')).toBe('••••••5432');
    expect(maskIdentifier('123')).toBe('•••');
  });
});
