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
 * Three separate keys per tenant: one for the search hash, one for encryption, one for
 * sealing evidence. Reusing a single key would let anyone holding one of them do the work
 * of the others, and the three have very different exposure. The signing key in
 * particular verifies documents that leave the building.
 *
 * Every key is also derived per version, so a rotation produces a new set without
 * touching the old one, and both remain usable while the rows move across (ADR-045).
 */

const KEY_BYTES = 32;
const HMAC_INFO = 'nx-verify/identifier-hmac/v1';
const ENCRYPTION_INFO = 'nx-verify/identifier-encryption/v1';
const SIGNING_INFO = 'nx-verify/evidence-signing/v1';

export interface TenantKeyProvider {
  /** The version new values are written with. */
  currentVersion(): Promise<number>;
  /** Every version still readable, so a rotation job knows what is left to move. */
  availableVersions(): Promise<number[]>;
  hmacKey(tenantId: string, version?: number): Promise<Buffer>;
  encryptionKey(tenantId: string, version?: number): Promise<Buffer>;
  /** Seals evidence. Separate again, because a signing key is published in effect. */
  signingKey(tenantId: string, version?: number): Promise<Buffer>;
}

export class DerivedTenantKeyProvider implements TenantKeyProvider {
  readonly #source: MasterKeySource;
  readonly #cache = new Map<string, Buffer>();

  constructor(source: MasterKeySource) {
    this.#source = source;
  }

  currentVersion(): Promise<number> {
    return this.#source.currentVersion();
  }

  availableVersions(): Promise<number[]> {
    return this.#source.availableVersions();
  }

  async hmacKey(tenantId: string, version?: number): Promise<Buffer> {
    return this.#derive(tenantId, HMAC_INFO, version ?? (await this.#source.currentVersion()));
  }

  async encryptionKey(tenantId: string, version?: number): Promise<Buffer> {
    return this.#derive(
      tenantId,
      ENCRYPTION_INFO,
      version ?? (await this.#source.currentVersion()),
    );
  }

  async signingKey(tenantId: string, version?: number): Promise<Buffer> {
    return this.#derive(tenantId, SIGNING_INFO, version ?? (await this.#source.currentVersion()));
  }

  async #derive(tenantId: string, info: string, version: number): Promise<Buffer> {
    assertUuid(tenantId, 'tenantId');
    const cacheKey = `${info}:${version}:${tenantId}`;
    const cached = this.#cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const master = await this.#source.masterKey(version);
    // The version is part of the derivation input as well as the cache key, so two
    // versions cannot produce the same key even if the roots were somehow equal.
    const derived = Buffer.from(
      hkdfSync('sha256', master, tenantId, `${info}/v${version}`, KEY_BYTES),
    );
    this.#cache.set(cacheKey, derived);
    return derived;
  }
}
