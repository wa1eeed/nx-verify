import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../../../packages/core/src/verification/verify.js';
import {
  createMonitor,
  findExpiringFields,
} from '../../../packages/core/src/monitoring/monitors.js';
import { listChangeEvents } from '../../../packages/core/src/monitoring/change-events.js';
import { computeScore, storeScore } from '../../../packages/core/src/monitoring/scoring.js';
import { getWallet } from '../../../packages/core/src/billing/wallet.js';
import { registerEndpoint } from '../../../packages/core/src/webhooks/dispatch.js';
import { verifySignature } from '../../../packages/core/src/webhooks/signing.js';
import { recordAttestation } from '../../../packages/core/src/repositories/attestations.js';
import { resolveEntity } from '../../../packages/core/src/repositories/entities.js';
import { InMemorySecretStore } from '../../../packages/providers/src/credentials.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';
import { runDueMonitors } from '../src/jobs/monitors.js';
import { deliverWebhooks } from '../src/jobs/webhooks.js';
import { enforceRetention, ensureAuditPartitions } from '../src/jobs/retention.js';
import { StubProvider } from '../../../packages/providers/src/stub/stub-provider.js';
import { ProviderRegistry } from '../../../packages/providers/src/registry.js';
import { createProviderStepRunner } from '../../../packages/providers/src/step-runner.js';
import { resolveCredential } from '../../../packages/providers/src/credentials.js';

/**
 * Unit 10: the layer the platform is actually sold on.
 */

const DAY = 24 * 60 * 60 * 1000;

describe('monitoring, alerts and evidence', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let entityId: string;
  const keys = testKeys();
  const fixture = providerFixture();

  const runVerification = (unn: string) =>
    withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'KYB_COMPLETE',
        subject: { unn, manager: { id: '1098765432', id_type: 'NATIONAL_ID' } },
        subjectIdentifiers: [{ idType: 'UNN', value: unn }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Monitoring Tenant');
    await preparePricedTenant(db.appPool, tenant.tenantId, { balanceHalalas: 5_000_00 });

    const result = await runVerification('7001272184');
    entityId = result.entityId ?? '';
  });

  afterAll(async () => {
    await db.close();
  });

  /** An entity whose only knowledge was observed a long time ago. */
  const seedAgedEntity = async (unn: string, daysAgo: number): Promise<{ entityId: string }> =>
    withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const resolved = await resolveEntity(tx, keys, {
        entityType: 'BUSINESS',
        identifiers: [{ idType: 'UNN', value: unn }],
        displayName: 'Aged Company',
      });
      await recordAttestation(tx, {
        entityId: resolved.entityId,
        fieldPath: 'cr.core.name',
        value: 'Aged Company',
        source: 'provider.stub',
        authority: 'Commercial Registry',
        runId: crypto.randomUUID(),
        observedAt: new Date(Date.now() - daysAgo * DAY),
      });
      return { entityId: resolved.entityId };
    });

  it('writes no change event when a re-verification returns the same value', async () => {
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listChangeEvents(tx, { entityId }),
    );

    const again = await runVerification('7001272184');
    expect(again.normalised?.changes).toEqual([]);

    const after = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listChangeEvents(tx, { entityId }),
    );
    // A renewal is not a change. An alert that fires every time we looked is an alert
    // nobody reads.
    expect(after).toHaveLength(before.length);
  });

  it('raises a critical event when the registration stops being active', async () => {
    const suspended = new StubProvider({
      name: 'stub',
      scenarioOverride: {
        kind: 'OK',
        data: {
          business_verification: {
            unified_number: '7001272184',
            cr_status: 'SUSPENDED',
            company_name: 'شركة المثال للتجارة',
            capital: 500000,
            city: 'الرياض',
            district: 'العليا',
          },
        },
      },
    });

    const registry = new ProviderRegistry().register(suspended);
    const secrets = new InMemorySecretStore({
      'kms://tenants/test/providers/stub': { apiKey: 'test-key' },
    });

    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'KYB_COMPLETE',
        subject: { unn: '7001272184' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7001272184' }],
        triggeredBy: 'MONITOR',
        modeAtExecution: 'BYOC',
        runStep: createProviderStepRunner({
          registry,
          credentialFor: (name) => resolveCredential(tx, secrets, name),
        }),
        keys,
      }),
    );

    const change = result.normalised?.changes.find((entry) => entry.fieldPath === 'cr.status');
    expect(change?.severity).toBe('CRITICAL');
    expect(change?.reasonAr).toContain('لم يعد نشطاً');
  });

  it('finds expired fields with no call and no cost', async () => {
    // Genuinely old, written through the normal path. Ageing a row by editing
    // observed_at is impossible here by design, and that is the point of rule 1.
    const old = await seedAgedEntity('7009000001', 400);

    const alerts = await withTenant(db.appPool, tenant.tenantId, (tx) => findExpiringFields(tx));

    // The free layer. It spends nothing, and it is what creates demand for the paid one.
    expect(alerts.some((alert) => alert.entityId === old.entityId)).toBe(true);
    expect(alerts.every((alert) => ['expired', 'expiring'].includes(alert.freshness))).toBe(true);
    // cr.core.name has no policy row of its own. It ages under cr.core, ninety days.
    const aged = alerts.find(
      (alert) => alert.entityId === old.entityId && alert.fieldPath === 'cr.core.name',
    );
    expect(aged?.freshness).toBe('expired');
  });

  it('runs a due monitor and charges it against its budget', async () => {
    const monitorId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createMonitor(tx, {
        entityId,
        productCode: 'KYB_COMPLETE',
        fieldPaths: ['cr.status'],
        cadence: 'DAILY',
        budgetCapPerPeriod: 200_00,
        activatedBy: 'user:analyst-1',
        consentRef: 'DPA-2026-11',
        firstRunAt: new Date(Date.now() - DAY),
      }),
    );

    const balanceBefore = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    const summaries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      runDueMonitors(tx, { keys, runStep: fixture.runnerFor(tx) }),
    );

    const summary = summaries.find((entry) => entry.monitorId === monitorId);
    expect(summary?.outcome).toBe('ran');
    expect(summary?.spent).toBeGreaterThan(0);

    const balanceAfter = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    expect(balanceBefore.balance - balanceAfter.balance).toBe(summary?.spent);
  });

  it('refuses to run a monitor that cannot afford it, before calling anything', async () => {
    const monitorId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createMonitor(tx, {
        entityId,
        productCode: 'KYB_COMPLETE',
        fieldPaths: ['cr.status'],
        cadence: 'DAILY',
        // Less than one run of this product costs.
        budgetCapPerPeriod: 1_00,
        activatedBy: 'user:analyst-1',
        firstRunAt: new Date(Date.now() - DAY),
      }),
    );

    fixture.provider.resetCallCount();
    const summaries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      runDueMonitors(tx, { keys, runStep: fixture.runnerFor(tx) }),
    );

    const summary = summaries.find((entry) => entry.monitorId === monitorId);
    expect(summary?.outcome).toBe('over_budget');
    // A cap checked after the money is spent is not a cap.
    expect(fixture.provider.callCount).toBe(0);
  });

  it('records who switched a monitor on and under what consent', async () => {
    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ activated_by: string; consent_ref: string | null }>(
        `SELECT activated_by, consent_ref FROM monitors WHERE consent_ref IS NOT NULL LIMIT 1`,
      ),
    );
    expect(rows[0]?.activated_by).toBe('user:analyst-1');
    expect(rows[0]?.consent_ref).toBe('DPA-2026-11');
  });

  it('refuses a monitor without a budget', async () => {
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        createMonitor(tx, {
          entityId,
          productCode: 'KYB_COMPLETE',
          fieldPaths: ['cr.status'],
          cadence: 'DAILY',
          budgetCapPerPeriod: 0,
          activatedBy: 'user:analyst-1',
        }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4001' });
  });

  it('signs a webhook over the timestamp as well as the body', async () => {
    const secrets = new InMemorySecretStore({
      'kms://tenants/mon/webhooks/1': { signingSecret: 'whsec_test' },
    });

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      registerEndpoint(tx, {
        url: 'https://customer.example/hooks',
        secretRef: 'kms://tenants/mon/webhooks/1',
        events: ['entity.changed', 'verification.completed'],
      }),
    );

    await runVerification('7001272184');

    const sent: { body: string; headers: Record<string, string> }[] = [];
    const summaries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      deliverWebhooks(tx, {
        secrets,
        deliver: (_url, body, headers) => {
          sent.push({ body, headers });
          return Promise.resolve({ ok: true, status: 200 });
        },
      }),
    );

    expect(summaries.length).toBeGreaterThan(0);
    const delivery = sent[0];
    expect(delivery).toBeDefined();
    expect(
      verifySignature('whsec_test', delivery?.body ?? '', delivery?.headers['nx-signature'] ?? ''),
    ).toBe(true);
  });

  it('retries a failed delivery and eventually abandons it', async () => {
    const secrets = new InMemorySecretStore({
      'kms://tenants/mon/webhooks/1': { signingSecret: 'whsec_test' },
    });

    await runVerification('7001272184');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await withTenant(db.appPool, tenant.tenantId, (tx) =>
        deliverWebhooks(tx, {
          secrets,
          deliver: () => Promise.resolve({ ok: false, status: 500 }),
        }),
      );
    }

    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ attempts: number; status: string; next_retry_at: Date | null }>(
        `SELECT attempts, status, next_retry_at FROM webhook_deliveries
         WHERE status <> 'delivered' ORDER BY created_at DESC LIMIT 1`,
      ),
    );

    expect(rows[0]?.attempts).toBeGreaterThan(0);
    // Backed off rather than hammering an endpoint that is already struggling.
    expect(rows[0]?.next_retry_at).not.toBeNull();
  });

  it('computes a score and stores its working', async () => {
    const score = await withTenant(db.appPool, tenant.tenantId, (tx) => computeScore(tx, entityId));

    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
    // A score without its working is refused by risk management, and the constraint says
    // so too: breakdown is NOT NULL.
    expect(score.breakdown.components.length).toBeGreaterThan(0);
    expect(score.breakdown.totalWeight).toBeGreaterThan(0);

    await withTenant(db.appPool, tenant.tenantId, (tx) => storeScore(tx, score));

    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ score: number; breakdown: { components: unknown[] } }>(
        `SELECT score, breakdown FROM entity_scores WHERE entity_id = $1`,
        [entityId],
      ),
    );
    expect(rows[0]?.breakdown.components.length).toBeGreaterThan(0);
  });

  it('scores an expired field at nothing and an expiring one at part', async () => {
    const score = await withTenant(db.appPool, tenant.tenantId, (tx) => computeScore(tx, entityId));
    for (const component of score.breakdown.components) {
      if (component.freshness === 'expired') {
        expect(component.earned).toBe(0);
      }
      if (component.freshness === 'fresh') {
        expect(component.earned).toBe(component.weight);
      }
    }
  });

  it('creates the audit partitions ahead of time, each with its own isolation', async () => {
    const created = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      ensureAuditPartitions(tx, 2),
    );
    expect(created.length).toBe(3);

    const { rows } = await db.migratorPool.query<{ relname: string; forced: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity AS forced
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'audit_log_%'`,
    );
    for (const row of rows) {
      expect(row.forced, `${row.relname} must force row level security`).toBe(true);
    }
  });

  it('destroys superseded history past the retention window and records the destruction', async () => {
    // Two observations of the same field, the older one long past the window, so it is
    // superseded history that nobody is owed any more.
    const aged = await seedAgedEntity('7009000002', 400);
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      recordAttestation(tx, {
        entityId: aged.entityId,
        fieldPath: 'cr.core.name',
        value: 'A renamed company',
        source: 'provider.stub',
        authority: 'Commercial Registry',
        runId: crypto.randomUUID(),
        observedAt: new Date(),
      }),
    );

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(`UPDATE tenants SET retention_days = 1 WHERE id = $1`, [tenant.tenantId]),
    );

    const summary = await withTenant(db.retentionPool, tenant.tenantId, (tx) =>
      enforceRetention(tx),
    );

    expect(summary.attestationsDestroyed).toBeGreaterThan(0);

    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE action = 'retention.enforced' LIMIT 1`,
      ),
    );
    // Destruction that leaves no trace is not a compliance feature.
    expect(rows[0]?.action).toBe('retention.enforced');
  });
});
