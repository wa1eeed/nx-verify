import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import { decide, listRulesets, simulateRuleset } from '../src/decision/engine.js';
import { evaluate } from '../src/decision/conditions.js';
import { setTenantTtl } from '../src/repositories/freshness.js';
import { getRun } from '../src/orchestration/run-recorder.js';
import { resolveEntity } from '../src/repositories/entities.js';
import { recordAttestation } from '../src/repositories/attestations.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';
import { StubProvider } from '../../../packages/providers/src/stub/stub-provider.js';
import { ProviderRegistry } from '../../../packages/providers/src/registry.js';
import { createProviderStepRunner } from '../../../packages/providers/src/step-runner.js';
import {
  InMemorySecretStore,
  resolveCredential,
} from '../../../packages/providers/src/credentials.js';
import type { ProfileField } from '../src/repositories/profile.js';
import type { EvaluationContext } from '../src/decision/conditions.js';

const RULESET = '1c9b0000-0000-4000-8000-000000000001';
const DAY = 24 * 60 * 60 * 1000;

function field(overrides: Partial<ProfileField> & { fieldPath: string }): ProfileField {
  return {
    value: 'ACTIVE',
    authority: 'Commercial Registry',
    observedAt: new Date(),
    effectiveUntil: null,
    ttlDays: null,
    weight: null,
    confidence: 1,
    freshness: 'fresh',
    attestationId: 'a1',
    ...overrides,
  };
}

function context(fields: ProfileField[], links: Record<string, number> = {}): EvaluationContext {
  return {
    fields: new Map(fields.map((entry) => [entry.fieldPath, entry])),
    linkCounts: new Map(Object.entries(links)),
  };
}

describe('the condition language', () => {
  it('treats an expired field as absent evidence rather than a present value', () => {
    const expired = context([field({ fieldPath: 'address.national.city', freshness: 'expired' })]);
    // Present in the table and absent as evidence. A decision that counts four month old
    // data as current is the decision this platform exists to prevent.
    expect(evaluate({ op: 'missing', field: 'address.national.city' }, expired)).toBe(true);
    expect(evaluate({ op: 'present', field: 'address.national.city' }, expired)).toBe(false);
  });

  it('does not treat a field we never obtained as a difference', () => {
    const empty = context([]);
    // Absence is `missing`, not `ne`. Conflating them turns every incomplete record into
    // a refusal.
    expect(evaluate({ op: 'ne', field: 'cr.status', value: 'ACTIVE' }, empty)).toBe(false);
    expect(evaluate({ op: 'missing', field: 'cr.status' }, empty)).toBe(true);
  });

  it('compares strings without case tripping it up', () => {
    const active = context([field({ fieldPath: 'cr.status', value: 'active' })]);
    expect(evaluate({ op: 'eq', field: 'cr.status', value: 'ACTIVE' }, active)).toBe(true);
    expect(evaluate({ op: 'ne', field: 'cr.status', value: 'ACTIVE' }, active)).toBe(false);
  });

  it('reads a network threshold', () => {
    const linked = context([], { MANAGES: 4 });
    expect(evaluate({ op: 'linked_gte', relation: 'MANAGES', value: 3 }, linked)).toBe(true);
    expect(evaluate({ op: 'linked_gte', relation: 'OWNS', value: 3 }, linked)).toBe(false);
  });

  it('always matches the default rule', () => {
    expect(evaluate({ op: 'always' }, context([]))).toBe(true);
  });
});

describe('the decision engine on real data', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Decision Tenant');
    await preparePricedTenant(db.appPool, tenant.tenantId, { balanceHalalas: 5_000_00 });
  });

  afterAll(async () => {
    await db.close();
  });

  const run = (unn: string) =>
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

  it('passes a complete and current record', async () => {
    const result = await run('7001272184');
    expect(result.decision?.outcome).toBe('PASS');
    expect(result.decision?.reasons[0]?.code).toBe('REQUIREMENTS_MET');
  });

  it('stores the decision and its reasons on the run', async () => {
    const result = await run('7001272184');
    const stored = await withTenant(db.appPool, tenant.tenantId, (tx) => getRun(tx, result.runId));

    expect(stored?.decision).toBe('PASS');
    // Bilingual, because the reason reaches an end user through the console and the API.
    expect(stored?.decisionReasons[0]?.message_ar).toBeTruthy();
    expect(stored?.decisionReasons[0]?.message_en).toBeTruthy();
  });

  it('fails a registration that is not active, and says which rule decided', async () => {
    const suspended = new StubProvider({
      name: 'stub',
      scenarioOverride: {
        kind: 'OK',
        data: {
          business_verification: {
            unified_number: '7002000001',
            cr_status: 'SUSPENDED',
            company_name: 'منشأة موقوفة',
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
        subject: { unn: '7002000001' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7002000001' }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: createProviderStepRunner({
          registry,
          credentialFor: (name) => resolveCredential(tx, secrets, name),
        }),
        keys,
      }),
    );

    expect(result.decision?.outcome).toBe('FAIL');
    expect(result.decision?.reasons[0]?.code).toBe('CR_NOT_ACTIVE');
    // The first rule that matched, recorded so the outcome is explainable later.
    expect(result.decision?.matchedSeq).toBe(1);
  });

  it('sends a stale registration status to review rather than passing it', async () => {
    const aged = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const entity = await resolveEntity(tx, keys, {
        entityType: 'BUSINESS',
        identifiers: [{ idType: 'UNN', value: '7002000002' }],
      });
      await recordAttestation(tx, {
        entityId: entity.entityId,
        fieldPath: 'cr.status',
        value: 'ACTIVE',
        source: 'provider.stub',
        authority: 'Commercial Registry',
        runId: crypto.randomUUID(),
        observedAt: new Date(Date.now() - 300 * DAY),
      });
      await recordAttestation(tx, {
        entityId: entity.entityId,
        fieldPath: 'address.national.city',
        value: 'الرياض',
        source: 'provider.stub',
        authority: 'National Address',
        runId: crypto.randomUUID(),
        observedAt: new Date(),
      });
      return entity.entityId;
    });

    const decision = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      decide(tx, aged, RULESET),
    );

    // Active as of ten months ago is not evidence that it is active today.
    expect(decision.outcome).toBe('REVIEW');
    expect(decision.reasons[0]?.code).toBe('CR_STATUS_STALE');
  });

  it('sends a record missing its address to review, not to failure', async () => {
    const partial = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const entity = await resolveEntity(tx, keys, {
        entityType: 'BUSINESS',
        identifiers: [{ idType: 'UNN', value: '7002000003' }],
      });
      await recordAttestation(tx, {
        entityId: entity.entityId,
        fieldPath: 'cr.status',
        value: 'ACTIVE',
        source: 'provider.stub',
        authority: 'Commercial Registry',
        runId: crypto.randomUUID(),
        observedAt: new Date(),
      });
      return entity.entityId;
    });

    const decision = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      decide(tx, partial, RULESET),
    );

    // Incomplete is a question for a human, not a refusal.
    expect(decision.outcome).toBe('REVIEW');
    expect(decision.reasons[0]?.code).toBe('ADDRESS_UNAVAILABLE');
  });

  it('raises the network signal when one manager signs for several companies', async () => {
    for (const unn of ['7003000001', '7003000002', '7003000003']) {
      await run(unn);
    }

    const last = await run('7003000003');
    // Not wrongdoing, and not nothing. A reason for a human to look.
    expect(last.decision?.outcome).toBe('REVIEW');
    expect(last.decision?.reasons[0]?.code).toBe('NETWORK_SIGNAL');
  });

  it('lets a tenant define its own ruleset without touching the default', async () => {
    const rulesetId = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO decision_rulesets (tenant_id, code, name_ar, name_en)
         VALUES ($1, 'STRICT', 'قواعد مشددة', 'Strict rules')
         RETURNING id`,
        [tenant.tenantId],
      );
      const id = rows[0]?.id ?? '';
      await tx.query(
        `INSERT INTO decision_rules (ruleset_id, seq, condition, outcome, reason_code, reason_ar, reason_en)
         VALUES ($1, 1, '{"op":"missing","field":"manager.signing_authority"}'::jsonb,
                 'FAIL', 'NO_SIGNATORY', 'لا مدير مفوّض', 'No authorised signatory'),
                ($1, 99, '{"op":"always"}'::jsonb, 'PASS', 'OK', 'مقبول', 'Accepted')`,
        [id],
      );
      return id;
    });

    const entity = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveEntity(tx, keys, {
        entityType: 'BUSINESS',
        identifiers: [{ idType: 'UNN', value: '7004000001' }],
      }),
    );

    const strict = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      decide(tx, entity.entityId, rulesetId),
    );
    const standard = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      decide(tx, entity.entityId, RULESET),
    );

    // The same facts, two conclusions. This is the part no data provider can sell.
    expect(strict.outcome).toBe('FAIL');
    expect(standard.outcome).toBe('REVIEW');

    const rulesets = await withTenant(db.appPool, tenant.tenantId, (tx) => listRulesets(tx));
    expect(rulesets.map((entry) => entry.code).sort()).toEqual(['KYB_DEFAULT', 'STRICT']);
    expect(rulesets.find((entry) => entry.code === 'KYB_DEFAULT')?.isDefault).toBe(true);
  });

  it('cannot see another tenant ruleset', async () => {
    const other = await seedTenant(db.appPool, 'Decision Other Tenant');
    const rulesets = await withTenant(db.appPool, other.tenantId, (tx) => listRulesets(tx));
    expect(rulesets.map((entry) => entry.code)).toEqual(['KYB_DEFAULT']);
  });

  it('simulates a ruleset over existing entities before it is switched on', async () => {
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      simulateRuleset(tx, RULESET, { limit: 50 }),
    );

    // Changing a rule blind is how a compliance team finds four hundred customers in
    // review on Monday morning.
    expect(before.entitiesEvaluated).toBeGreaterThan(0);
    const total = before.outcomes.PASS + before.outcomes.FAIL + before.outcomes.REVIEW;
    expect(total).toBe(before.entitiesEvaluated);
  });

  it('makes no decision when a product has no ruleset, rather than inventing one', async () => {
    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'ADDRESS_ONLY',
        subject: { unn: '7001272184' },
        subjectIdentifiers: [{ idType: 'UNN', value: '7001272184' }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

    expect(result.decision?.outcome).toBe('REVIEW');
    expect(result.decision?.rulesetId).toBeNull();
  });

  it('treats a TTL change as a decision input with no rewrite', async () => {
    const entity = await run('7005000001');

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      setTenantTtl(tx, { fieldPath: 'cr.status', ttlDays: 1, weight: 20 }),
    );

    const after = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      decide(tx, entity.entityId ?? '', RULESET),
    );

    // Freshness is arithmetic, and here it feeds the decision directly. Nothing was
    // written to reach this conclusion.
    expect(['PASS', 'REVIEW']).toContain(after.outcome);
  });
});
