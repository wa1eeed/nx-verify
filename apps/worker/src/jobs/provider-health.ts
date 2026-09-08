import { audit } from '@nx-verify/core';
import type { TenantTransaction } from '@nx-verify/db';
import type { ProviderRegistry, SecretStore } from '@nx-verify/providers';
import { resolveCredential } from '@nx-verify/providers';

/**
 * Checking that a bound provider is actually answering.
 *
 * Routing skips a provider whose health is `down` (ADR-043), and until now nothing set
 * that column. A dead provider therefore stayed recorded as healthy for ever, and traffic
 * kept going to it. A field that decides routing and is never written is worse than no
 * field, because it looks like the decision is being made.
 *
 * Three outcomes, and the distinction between them matters:
 *
 *   The provider answered. Recorded as healthy or degraded, from what it said.
 *   The provider did not answer, or its credential is missing. Recorded as down, and
 *   routing moves to the next binding.
 *   The provider is not registered in this deployment. Left untouched, because that is
 *   another environment's configuration and this one knows nothing about it.
 */

export interface ProviderHealthOptions {
  registry: ProviderRegistry;
  secrets: SecretStore;
  now?: Date;
}

export interface ProviderHealthSummary {
  provider: string;
  status: 'healthy' | 'degraded' | 'down' | 'skipped';
  latencyMs: number | null;
}

export async function checkProviderHealth(
  tx: TenantTransaction,
  options: ProviderHealthOptions,
): Promise<ProviderHealthSummary[]> {
  const { rows } = await tx.query<{
    provider: string;
    credential_ref: string | null;
    health_status: string;
  }>(
    `SELECT provider, credential_ref, health_status
     FROM tenant_provider_binding
     WHERE tenant_id = $1 AND activated_at IS NOT NULL
     ORDER BY priority, provider`,
    [tx.tenantId],
  );

  const summaries: ProviderHealthSummary[] = [];

  for (const binding of rows) {
    if (!options.registry.has(binding.provider)) {
      // Configuration from elsewhere. Marking it down would be a claim this deployment
      // has no basis for.
      summaries.push({ provider: binding.provider, status: 'skipped', latencyMs: null });
      continue;
    }

    const provider = options.registry.get(binding.provider);

    let status: 'healthy' | 'degraded' | 'down' = 'down';
    let latencyMs: number | null = null;

    try {
      const credential = await resolveCredential(
        tx,
        options.secrets,
        binding.provider,
        binding.credential_ref,
      );
      const health = await provider.healthCheck(credential);
      status = health.status;
      latencyMs = health.latencyMs ?? null;
    } catch {
      // A binding whose credential cannot be fetched is down, whatever the provider
      // would have said. There is no way to call it.
      status = 'down';
    }

    await tx.query(
      `UPDATE tenant_provider_binding
       SET health_status = $3, last_tested_at = $4, updated_at = now()
       WHERE tenant_id = $1 AND provider = $2`,
      [tx.tenantId, binding.provider, status, options.now ?? new Date()],
    );

    // A provider changing state is worth a line in the audit trail, because it is the
    // explanation for why a run went somewhere else that day.
    if (status !== binding.health_status) {
      await audit(tx, {
        actorType: 'SYSTEM',
        actorId: 'provider-health-job',
        action: 'provider.health_changed',
        target: binding.provider,
        metadata: { from: binding.health_status, to: status },
      });
    }

    summaries.push({ provider: binding.provider, status, latencyMs });
  }

  return summaries;
}
