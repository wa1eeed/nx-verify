import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '@nx-verify/core';
import type { ProviderMode, ResolvedCredential } from './types.js';

/**
 * Credential resolution.
 *
 * The binding is read from tenant_provider_binding, never from a global environment
 * variable, because mode and credential are per (tenant, provider) (ADR-005). The row
 * holds a KMS reference and the secret store turns that into material that lives for the
 * duration of one call.
 */

export interface SecretStore {
  /** Fetches the material behind a kms:// reference. */
  fetch(ref: string): Promise<Readonly<Record<string, string>>>;
}

export interface ProviderBinding {
  provider: string;
  mode: ProviderMode;
  credentialRef: string | null;
  rateLimitRps: number;
  healthStatus: string;
  activatedAt: Date | null;
}

export async function getProviderBinding(
  tx: TenantTransaction,
  provider: string,
): Promise<ProviderBinding | null> {
  const { rows } = await tx.query<{
    provider: string;
    mode: ProviderMode;
    credential_ref: string | null;
    rate_limit_rps: number;
    health_status: string;
    activated_at: Date | null;
  }>(
    `SELECT provider, mode, credential_ref, rate_limit_rps, health_status, activated_at
     FROM tenant_provider_binding
     WHERE tenant_id = $1 AND provider = $2`,
    [tx.tenantId, provider],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    provider: row.provider,
    mode: row.mode,
    credentialRef: row.credential_ref,
    rateLimitRps: row.rate_limit_rps,
    healthStatus: row.health_status,
    activatedAt: row.activated_at,
  };
}

export async function resolveCredential(
  tx: TenantTransaction,
  secrets: SecretStore,
  provider: string,
): Promise<ResolvedCredential> {
  const binding = await getProviderBinding(tx, provider);
  if (!binding) {
    // The provider name is internal, so it does not go into the message (rule 5).
    throw new NxError('NX-4041', { detail: 'no provider binding for this tenant' });
  }
  if (!binding.credentialRef) {
    throw new NxError('NX-5001', { detail: 'provider binding has no credential reference' });
  }

  const material = await secrets.fetch(binding.credentialRef);
  return { ref: binding.credentialRef, mode: binding.mode, material };
}

/** For tests and local work. A KMS backed store replaces it in every real environment. */
export class InMemorySecretStore implements SecretStore {
  readonly #entries: Map<string, Readonly<Record<string, string>>>;

  constructor(entries: Record<string, Record<string, string>> = {}) {
    this.#entries = new Map(Object.entries(entries));
  }

  set(ref: string, material: Record<string, string>): void {
    this.#entries.set(ref, material);
  }

  fetch(ref: string): Promise<Readonly<Record<string, string>>> {
    const material = this.#entries.get(ref);
    if (!material) {
      // The reference is safe to name. The material never appears in an error.
      throw new NxError('NX-5001', { detail: `no secret stored for reference ${ref}` });
    }
    return Promise.resolve(material);
  }
}
