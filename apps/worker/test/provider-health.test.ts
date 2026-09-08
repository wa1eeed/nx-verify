import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { resolveProviders } from '../../../packages/core/src/routing/provider-routing.js';
import { readAudit } from '../../../packages/core/src/auth/audit.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant } from '../../../test/helpers/billing.js';
import {
  InMemorySecretStore,
  ProviderRegistry,
  StubProvider,
} from '../../../packages/providers/src/index.js';
import { checkProviderHealth } from '../src/jobs/provider-health.js';

/**
 * Provider health, and the routing decision that depends on it.
 *
 * The column that decides routing was never written by anything. These tests are about
 * closing that, and about the difference between a provider that is down and one this
 * deployment simply does not run.
 */

const LIVE = 'live-provider';
const ABSENT = 'absent-provider';
const NO_SECRET = 'unreachable-provider';

describe('provider health', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  const registry = new ProviderRegistry()
    .register(new StubProvider({ name: LIVE }))
    .register(new StubProvider({ name: NO_SECRET }));

  const secrets = new InMemorySecretStore({
    'kms://tenants/health/live': { apiKey: 'live-key' },
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Health Tenant');
    await preparePricedTenant(db.appPool, tenant.tenantId);

    await db.operatorPool.query(
      `INSERT INTO tenant_provider_binding
         (tenant_id, provider, mode, credential_ref, priority, activated_at)
       VALUES ($1, $2, 'BYOC', 'kms://tenants/health/live', 10, now()),
              ($1, $3, 'BYOC', 'kms://tenants/health/missing', 20, now()),
              ($1, $4, 'BYOC', 'kms://tenants/health/other', 30, now())`,
      [tenant.tenantId, LIVE, NO_SECRET, ABSENT],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('records a provider that answers as healthy', async () => {
    const summaries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      checkProviderHealth(tx, { registry, secrets }),
    );

    expect(summaries.find((entry) => entry.provider === LIVE)?.status).toBe('healthy');
  });

  it('records a provider whose credential is missing as down', async () => {
    const summaries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      checkProviderHealth(tx, { registry, secrets }),
    );

    // There is no way to call it, whatever the provider would have said.
    expect(summaries.find((entry) => entry.provider === NO_SECRET)?.status).toBe('down');
  });

  it('leaves a provider this deployment does not run alone', async () => {
    const summaries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      checkProviderHealth(tx, { registry, secrets }),
    );

    expect(summaries.find((entry) => entry.provider === ABSENT)?.status).toBe('skipped');

    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ health_status: string; last_tested_at: Date | null }>(
        `SELECT health_status, last_tested_at FROM tenant_provider_binding WHERE provider = $1`,
        [ABSENT],
      ),
    );

    // Marking it down would be a claim this deployment has no basis for.
    expect(rows[0]?.health_status).toBe('unknown');
    expect(rows[0]?.last_tested_at).toBeNull();
  });

  it('takes a provider out of routing once it is down, and puts it back when it returns', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      checkProviderHealth(tx, { registry, secrets }),
    );

    const whileDown = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveProviders(tx, {
        endpoint: 'business_verification',
        declaredProvider: 'stub',
        declaredFallback: null,
      }),
    );

    // The unreachable one is gone from the list. This is the whole reason the column
    // exists, and until now nothing wrote it.
    expect(whileDown.map((candidate) => candidate.provider)).not.toContain(NO_SECRET);
    expect(whileDown.map((candidate) => candidate.provider)).toContain(LIVE);

    // Give it its secret and check again.
    secrets.set('kms://tenants/health/missing', { apiKey: 'now-present' });
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      checkProviderHealth(tx, { registry, secrets }),
    );

    const afterRecovery = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveProviders(tx, {
        endpoint: 'business_verification',
        declaredProvider: 'stub',
        declaredFallback: null,
      }),
    );
    expect(afterRecovery.map((candidate) => candidate.provider)).toContain(NO_SECRET);
  });

  it('records a change of state, since it explains where a run went that day', async () => {
    const entries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      readAudit(tx, { action: 'provider.health_changed' }),
    );

    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.actorType).toBe('SYSTEM');
  });

  it('ignores a binding that was never activated', async () => {
    const idle = await seedTenant(db.appPool, 'Health Idle Tenant');
    await db.operatorPool.query(
      `INSERT INTO tenant_provider_binding (tenant_id, provider, mode, priority)
       VALUES ($1, $2, 'BYOC', 10)`,
      [idle.tenantId, LIVE],
    );

    const summaries = await withTenant(db.appPool, idle.tenantId, (tx) =>
      checkProviderHealth(tx, { registry, secrets }),
    );
    expect(summaries).toEqual([]);
  });
});
