import type { TenantTransaction } from '@nx-verify/db';
import { audit } from '../auth/audit.js';
import { NxError } from '../errors.js';

/**
 * Which provider serves this subscriber.
 *
 * ADR-043: the tenant's bindings decide, in priority order, and the provider named in the
 * product is the last resort. A product says which authority it needs. It does not get to
 * say whose pipe we use to reach it, because that changes with contracts, outages and
 * prices, and a product definition should not have to be edited when any of those move.
 *
 * This returns names to the caller in packages/providers, which is the only place allowed
 * to turn a name into a call (ADR-016). Nothing here imports a provider.
 */

export type BindingLevel = 'tenant' | 'product';

export interface ProviderCandidate {
  provider: string;
  mode: 'MANAGED' | 'BYOC';
  credentialRef: string | null;
  level: BindingLevel;
}

export interface ResolveProvidersInput {
  endpoint: string;
  /** The provider the product step declares. Last in line, never first. */
  declaredProvider: string;
  declaredFallback?: string | null;
}

export async function resolveProviders(
  tx: TenantTransaction,
  input: ResolveProvidersInput,
): Promise<ProviderCandidate[]> {
  const { rows } = await tx.query<{
    provider: string;
    mode: 'MANAGED' | 'BYOC';
    credential_ref: string | null;
  }>('SELECT provider, mode, credential_ref FROM app.resolve_providers($1, $2)', [
    tx.tenantId,
    input.endpoint,
  ]);

  const candidates: ProviderCandidate[] = rows.map((row) => ({
    provider: row.provider,
    mode: row.mode,
    credentialRef: row.credential_ref,
    level: 'tenant',
  }));

  // The product's own choice comes last, and only if no binding already named it. A
  // catalogue that still names a provider keeps working, which is what lets this be
  // introduced without rewriting every product row.
  for (const declared of [input.declaredProvider, input.declaredFallback]) {
    if (declared && !candidates.some((candidate) => candidate.provider === declared)) {
      candidates.push({
        provider: declared,
        mode: 'BYOC',
        credentialRef: null,
        level: 'product',
      });
    }
  }

  return candidates;
}

/**
 * The operator's view of one subscriber's providers.
 *
 * Deliberately not reachable from any tenant facing route. Reading this is learning the
 * provider names, and rule 5 exists to stop a customer learning them.
 */
export interface TenantBinding {
  provider: string;
  mode: 'MANAGED' | 'BYOC';
  credentialRef: string | null;
  priority: number;
  endpoints: string[] | null;
  healthStatus: string;
  activatedAt: Date | null;
}

export async function listTenantBindings(tx: TenantTransaction): Promise<TenantBinding[]> {
  const { rows } = await tx.query<{
    provider: string;
    mode: 'MANAGED' | 'BYOC';
    credential_ref: string | null;
    priority: number;
    endpoints: string[] | null;
    health_status: string;
    activated_at: Date | null;
  }>(
    `SELECT provider, mode, credential_ref, priority, endpoints, health_status, activated_at
     FROM tenant_provider_binding
     WHERE tenant_id = $1
     ORDER BY priority, provider`,
    [tx.tenantId],
  );

  return rows.map((row) => ({
    provider: row.provider,
    mode: row.mode,
    credentialRef: row.credential_ref,
    priority: row.priority,
    endpoints: row.endpoints,
    healthStatus: row.health_status,
    activatedAt: row.activated_at,
  }));
}

export interface SetBindingInput {
  tenantId: string;
  provider: string;
  mode: 'MANAGED' | 'BYOC';
  credentialRef?: string | null;
  priority?: number;
  endpoints?: string[] | null;
  activate?: boolean;
}

/**
 * Binds a subscriber to a provider, or changes the binding.
 *
 * Runs as the operator role, which is the only role in the system whose policy crosses
 * tenants. That is acceptable here and nowhere else: it covers configuration rather than
 * data, and the role can reach no attestation, no identifier and no run.
 */
export async function setTenantBinding(
  tx: { query: TenantTransaction['query'] },
  input: SetBindingInput,
  operatorId: string,
): Promise<void> {
  if (input.credentialRef && !input.credentialRef.startsWith('kms://')) {
    // The database refuses this too. Saying it here gives a usable message.
    throw new NxError('NX-4001', { detail: 'a credential must be a kms:// reference' });
  }

  await tx.query(
    `INSERT INTO tenant_provider_binding
       (tenant_id, provider, mode, credential_ref, priority, endpoints, activated_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() ELSE NULL END, now())
     ON CONFLICT (tenant_id, provider) DO UPDATE SET
       mode = EXCLUDED.mode,
       credential_ref = EXCLUDED.credential_ref,
       priority = EXCLUDED.priority,
       endpoints = EXCLUDED.endpoints,
       activated_at = CASE WHEN $7 THEN COALESCE(tenant_provider_binding.activated_at, now()) ELSE NULL END,
       updated_at = now()`,
    [
      input.tenantId,
      input.provider,
      input.mode,
      input.credentialRef ?? null,
      input.priority ?? 100,
      input.endpoints ?? null,
      input.activate ?? true,
    ],
  );

  await tx.query(
    `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target, metadata)
     VALUES ($1, 'NX_STAFF', $2, 'provider.binding_set', $3, $4::jsonb)`,
    [
      input.tenantId,
      operatorId,
      input.provider,
      // The reference is recorded, never the material.
      JSON.stringify({
        mode: input.mode,
        priority: input.priority ?? 100,
        credential_ref: input.credentialRef ?? null,
      }),
    ],
  );
  void audit;
}

export interface CatalogEntry {
  code: string;
  nameAr: string;
  nameEn: string;
  endpoints: string[];
  status: 'active' | 'suspended';
  notes: string | null;
}

export async function listCatalog(tx: {
  query: TenantTransaction['query'];
}): Promise<CatalogEntry[]> {
  const { rows } = await tx.query<{
    code: string;
    name_ar: string;
    name_en: string;
    endpoints: string[];
    status: 'active' | 'suspended';
    notes: string | null;
  }>(
    `SELECT code, name_ar, name_en, endpoints, status, notes
     FROM provider_catalog ORDER BY code`,
  );

  return rows.map((row) => ({
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    endpoints: row.endpoints,
    status: row.status,
    notes: row.notes,
  }));
}

export async function upsertCatalogEntry(
  tx: { query: TenantTransaction['query'] },
  entry: CatalogEntry,
): Promise<void> {
  await tx.query(
    `INSERT INTO provider_catalog (code, name_ar, name_en, endpoints, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (code) DO UPDATE SET
       name_ar = EXCLUDED.name_ar,
       name_en = EXCLUDED.name_en,
       endpoints = EXCLUDED.endpoints,
       status = EXCLUDED.status,
       notes = EXCLUDED.notes,
       updated_at = now()`,
    [entry.code, entry.nameAr, entry.nameEn, entry.endpoints, entry.status, entry.notes],
  );
}
