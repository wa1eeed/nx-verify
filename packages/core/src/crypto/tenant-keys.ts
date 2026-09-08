import { hkdfSync } from 'node:crypto';
import { assertUuid } from '@nx-verify/db';
import type { MasterKeySource } from './master-key.js';

/**
 * One key per tenant, derived rather than stored.
 *
 * docs/01-blueprint.md section 7 requires a per tenant encryption key, not one key for
 * the system. Deriving from a single root with the tenant id as salt gives that without
 * a key table, which would be a credential in the database and is forbidden by rule 10.
 *
 * Two separate keys per tenant, one for the search hash and one for encryption. Reusing
 * a single key for both would let anyone holding the encryption key recompute lookup
 * hashes, and the two have very different exposure.
 */

const KEY_BYTES = 32;
const HMAC_INFO = 'nx-verify/identifier-hmac/v1';
const ENCRYPTION_INFO = 'nx-verify/identifier-encryption/v1';

export interface TenantKeyProvider {
  hmacKey(tenantId: string): Promise<Buffer>;
  encryptionKey(tenantId: string): Promise<Buffer>;
}

export class DerivedTenantKeyProvider implements TenantKeyProvider {
  readonly #source: MasterKeySource;
  readonly #cache = new Map<string, Buffer>();

  constructor(source: MasterKeySource) {
    this.#source = source;
  }

  hmacKey(tenantId: string): Promise<Buffer> {
    return this.#derive(tenantId, HMAC_INFO);
  }

  encryptionKey(tenantId: string): Promise<Buffer> {
    return this.#derive(tenantId, ENCRYPTION_INFO);
  }

  async #derive(tenantId: string, info: string): Promise<Buffer> {
    assertUuid(tenantId, 'tenantId');
    const cacheKey = `${info}:${tenantId}`;
    const cached = this.#cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const master = await this.#source.masterKey();
    const derived = Buffer.from(hkdfSync('sha256', master, tenantId, info, KEY_BYTES));
    this.#cache.set(cacheKey, derived);
    return derived;
  }
}
