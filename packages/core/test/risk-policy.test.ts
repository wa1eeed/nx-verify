import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  assessCustomer,
  type AssessmentInput,
  type FactView,
} from '../src/customers/indicators.js';
import {
  DEFAULT_RISK_POLICY,
  resolveRiskPolicy,
  type RiskPolicy,
} from '../src/customers/risk-policy.js';
import {
  riskModel,
  setCategoryRisk,
  setProductRisk,
  setRiskBands,
  setRiskSignal,
  setTenantCategoryRisk,
  setTenantRiskBands,
  setTenantRiskSignal,
  tenantRiskModel,
} from '../src/customers/risk-admin.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant } from '../../../test/helpers/billing.js';

/**
 * The risk model as rows, and the same score from it (ADR-138).
 *
 * The first thing proven here is that nothing moved: a model read from the database scores a
 * customer exactly as the constants did. A refactor that relocates a number must not change
 * the number, and a risk score is the worst place to find out otherwise.
 *
 * The rest is what the owner asked for: a weight, a threshold and a band that can be set, per
 * signal, for the platform and then differently for one subscriber, with everything they have
 * no opinion about still inherited rather than frozen at the moment they were created.
 */

const observed = new Date('2026-09-01T00:00:00Z');
const fact = (value: unknown): FactView => ({ value, freshness: 'fresh', observedAt: observed });

/** A company whose registry is read and active, sharing an address with two other customers. */
function company(over: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    kind: 'COMPANY',
    isFreelancer: false,
    facts: new Map([
      ['cr.status_code', fact(1)],
      ['cr.status', fact('نشط')],
    ]),
    managers: [],
    accountsSharedWith: 0,
    addressSharedWith: 2,
    openChanges: 0,
    now: new Date('2026-09-16T00:00:00Z'),
    ...over,
  };
}

const policyWith = (over: Partial<RiskPolicy>): RiskPolicy => ({ ...DEFAULT_RISK_POLICY, ...over });

const withSignal = (code: string, over: Partial<RiskPolicy['signals'][string]>): RiskPolicy => {
  const shipped = DEFAULT_RISK_POLICY.signals[code] ?? {
    weight: 0,
    enabled: true,
    threshold: null,
  };
  return policyWith({
    signals: { ...DEFAULT_RISK_POLICY.signals, [code]: { ...shipped, ...over } },
  });
};

describe('the risk model as data', () => {
  it('scores a customer the same with no policy as with the one we ship', () => {
    const bare = assessCustomer(company());
    const shipped = assessCustomer(company({ riskPolicy: DEFAULT_RISK_POLICY }));
    expect(bare.riskScore).toBe(shipped.riskScore);
    expect(bare.riskLevel).toBe(shipped.riskLevel);
    // The shared address is the only thing against this customer, and it weighs fourteen.
    expect(bare.riskScore).toBe(14);
    expect(bare.riskReasons.map((reason) => reason.key)).toEqual(['shared_address']);
  });

  it('weighs a signal by what the policy says, not by what the code used to say', () => {
    const assessment = assessCustomer(
      company({ riskPolicy: withSignal('shared_address', { weight: 55 }) }),
    );
    expect(assessment.riskScore).toBe(55);
    expect(assessment.riskReasons[0]?.weight).toBe(55);
  });

  it('does not raise a signal that is switched off, rather than raising it at zero', () => {
    const assessment = assessCustomer(
      company({ riskPolicy: withSignal('shared_address', { enabled: false }) }),
    );
    // Off the list a reader sees and out of the arithmetic together: what somebody is shown
    // and what the number is made of have to be the same thing.
    expect(assessment.signals.map((signal) => signal.key)).not.toContain('shared_address');
    expect(assessment.riskReasons).toHaveLength(0);
    expect(assessment.riskScore).toBe(0);
  });

  it('fires a signal at the threshold the policy sets, and not before it', () => {
    const managers = [{ name: 'مدير', hasPermissions: true, otherCompanies: 4 }];
    expect(assessCustomer(company({ managers })).signals.map((signal) => signal.key)).toContain(
      'manager_many_companies',
    );
    // A subscriber for whom four other companies is ordinary says so, and the signal is silent.
    expect(
      assessCustomer(
        company({ managers, riskPolicy: withSignal('manager_many_companies', { threshold: 5 }) }),
      ).signals.map((signal) => signal.key),
    ).not.toContain('manager_many_companies');
  });

  it('moves the band without moving the score', () => {
    const strict = assessCustomer(
      company({ riskPolicy: policyWith({ highFrom: 14, mediumFrom: 7 }) }),
    );
    expect(strict.riskScore).toBe(14);
    // The same fourteen, read as high by a subscriber who says fourteen is high.
    expect(strict.riskLevel).toBe('HIGH');
    expect(strict.riskLabelAr).toBe('عالية');
    expect(assessCustomer(company()).riskLevel).toBe('LOW');
  });

  it('counts as many unfilled sections as the policy counts, and no more', () => {
    const sections = ['العنوان الوطني', 'المعلومات المصرفية', 'المدراء المفوضون', 'عقد التأسيس'];
    // Three by default, at ten each, plus the shared address.
    expect(assessCustomer(company({ incompleteSections: sections })).riskScore).toBe(44);
    expect(
      assessCustomer(
        company({
          incompleteSections: sections,
          riskPolicy: withSignal('incomplete_section', { threshold: 1 }),
        }),
      ).riskScore,
    ).toBe(24);
    // Switched off entirely, an unfinished file stops counting against the customer at all.
    expect(
      assessCustomer(
        company({
          incompleteSections: sections,
          riskPolicy: withSignal('incomplete_section', { enabled: false }),
        }),
      ).riskScore,
    ).toBe(14);
  });
});

describe('editing the risk model from the panel', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let other: SeededTenant;
  const staff = 'nx-staff:test';

  const policyOf = (subscriber: SeededTenant) =>
    withTenant(db.appPool, subscriber.tenantId, (tx) => resolveRiskPolicy(tx));

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Risk Tenant');
    other = await seedTenant(db.appPool, 'Another Subscriber');
    await preparePricedTenant(db, tenant.tenantId, { balanceHalalas: 100_00 });
    await preparePricedTenant(db, other.tenantId, { balanceHalalas: 100_00 });
  });

  afterAll(async () => {
    await db.close();
  });

  it('starts as exactly the model the code used to carry', async () => {
    const model = await riskModel(db.operatorPool);
    expect(model.bands).toEqual({ highFrom: 60, mediumFrom: 30 });
    const weights = Object.fromEntries(model.signals.map((signal) => [signal.code, signal.weight]));
    for (const [code, shipped] of Object.entries(DEFAULT_RISK_POLICY.signals)) {
      expect(weights[code]).toBe(shipped.weight);
    }
    // And a subscriber who has said nothing reads back the same thing.
    expect(await policyOf(tenant)).toEqual(DEFAULT_RISK_POLICY);
  });

  it('names the verification service each signal reads, which is how risk is switched per service', async () => {
    const model = await riskModel(db.operatorPool);
    const byCode = new Map(model.signals.map((signal) => [signal.code, signal]));
    expect(byCode.get('iban_mismatch')?.productCode).toBe('IBAN_VERIFICATION');
    expect(byCode.get('iban_mismatch')?.productNameAr).toBe('الآيبان والحساب البنكي');
    expect(byCode.get('liquidation')?.category).toBe('STATUS');
    expect(byCode.get('shared_address')?.category).toBe('INTERSECTION');
    // A gap in the file reads no one service, so it names none.
    expect(byCode.get('incomplete_section')?.productCode).toBeNull();
  });

  it('changes a weight for the whole platform, and every subscriber reads the new one', async () => {
    await setRiskSignal(db.operatorPool, { code: 'shared_address', weight: 40 }, staff);
    expect((await policyOf(tenant)).signals.shared_address?.weight).toBe(40);
    expect((await policyOf(other)).signals.shared_address?.weight).toBe(40);
  });

  it('switches risk scoring off for one verification service, and every signal it feeds', async () => {
    const changed = await setProductRisk(
      db.operatorPool,
      { productCode: 'IBAN_VERIFICATION', enabled: false },
      staff,
    );
    // Three signals read the bank check: the mismatch, the partial match and the dead account.
    expect(changed).toBeGreaterThanOrEqual(3);
    const policy = await policyOf(tenant);
    expect(policy.signals.iban_mismatch?.enabled).toBe(false);
    expect(policy.signals.account_inactive?.enabled).toBe(false);
    // And nothing else moved.
    expect(policy.signals.liquidation?.enabled).toBe(true);

    await setProductRisk(
      db.operatorPool,
      { productCode: 'IBAN_VERIFICATION', enabled: true },
      staff,
    );
    expect((await policyOf(tenant)).signals.iban_mismatch?.enabled).toBe(true);
  });

  it('switches a whole kind of doubt off, which is the other axis an owner decides along', async () => {
    const changed = await setCategoryRisk(
      db.operatorPool,
      { category: 'INTERSECTION', enabled: false },
      staff,
    );
    // Three signals are intersections: a shared account, a shared address, a shared manager.
    expect(changed).toBe(3);
    const policy = await policyOf(tenant);
    expect(policy.signals.shared_account?.enabled).toBe(false);
    expect(policy.signals.shared_address?.enabled).toBe(false);
    expect(policy.signals.manager_many_companies?.enabled).toBe(false);
    // And a doubt of another kind is untouched.
    expect(policy.signals.liquidation?.enabled).toBe(true);

    await setCategoryRisk(db.operatorPool, { category: 'INTERSECTION', enabled: true }, staff);
    expect((await policyOf(tenant)).signals.shared_account?.enabled).toBe(true);
  });

  it('switches a kind of doubt off for one subscriber, and back to inherited rather than on', async () => {
    await setTenantCategoryRisk(
      db.operatorPool,
      { tenantId: tenant.tenantId, category: 'CHANGE', enabled: false },
      staff,
    );
    expect((await policyOf(tenant)).signals.open_changes?.enabled).toBe(false);
    expect((await policyOf(other)).signals.open_changes?.enabled).toBe(true);

    // Resuming lifts their exception rather than writing «on» over it, so a later platform
    // decision about that kind reaches them again.
    await setTenantCategoryRisk(
      db.operatorPool,
      { tenantId: tenant.tenantId, category: 'CHANGE', enabled: null },
      staff,
    );
    const model = await tenantRiskModel(db.operatorPool, tenant.tenantId);
    expect(model.signals.find((signal) => signal.code === 'open_changes')?.source).toBe('platform');
  });

  it('refuses a weight outside the scale and a band that is upside down', async () => {
    await expect(
      setRiskSignal(db.operatorPool, { code: 'shared_address', weight: 140 }, staff),
    ).rejects.toMatchObject({ code: 'NX-4002' });
    await expect(
      setRiskBands(db.operatorPool, { highFrom: 30, mediumFrom: 60 }, staff),
    ).rejects.toMatchObject({ code: 'NX-4002' });
    // And a threshold on a signal whose condition reads none.
    await expect(
      setRiskSignal(db.operatorPool, { code: 'liquidation', threshold: 3 }, staff),
    ).rejects.toMatchObject({ code: 'NX-4002' });
  });

  it('lets one subscriber disagree, without touching anybody else', async () => {
    await setTenantRiskSignal(
      db.operatorPool,
      { tenantId: tenant.tenantId, code: 'shared_address', weight: 5 },
      staff,
    );
    expect((await policyOf(tenant)).signals.shared_address?.weight).toBe(5);
    expect((await policyOf(other)).signals.shared_address?.weight).toBe(40);
  });

  it('keeps inheriting everything the subscriber had no opinion about', async () => {
    // They set a weight and said nothing about the threshold, so a later platform change to
    // the threshold still reaches them. Inheritance by reference, not a copy.
    await setRiskSignal(db.operatorPool, { code: 'shared_address', threshold: 2 }, staff);
    const policy = await policyOf(tenant);
    expect(policy.signals.shared_address?.weight).toBe(5);
    expect(policy.signals.shared_address?.threshold).toBe(2);
  });

  it('says of each part of a subscriber model whether they chose it or inherited it', async () => {
    const model = await tenantRiskModel(db.operatorPool, tenant.tenantId);
    const shared = model.signals.find((signal) => signal.code === 'shared_address');
    expect(shared).toMatchObject({ source: 'subscriber', effectiveWeight: 5, weight: 40 });
    expect(shared?.decidedBy).toBe(staff);
    const liquidation = model.signals.find((signal) => signal.code === 'liquidation');
    expect(liquidation).toMatchObject({ source: 'platform', effectiveWeight: 70 });
    expect(model.bandsSource).toBe('platform');
  });

  it('gives one subscriber their own bands, and returns them when the exception is lifted', async () => {
    await setTenantRiskBands(
      db.operatorPool,
      { tenantId: tenant.tenantId, highFrom: 40, mediumFrom: 20 },
      staff,
    );
    expect(await policyOf(tenant)).toMatchObject({ highFrom: 40, mediumFrom: 20 });
    expect(await policyOf(other)).toMatchObject({ highFrom: 60, mediumFrom: 30 });

    const model = await tenantRiskModel(db.operatorPool, tenant.tenantId);
    expect(model.bandsSource).toBe('subscriber');
    expect(model.platformBands).toEqual({ highFrom: 60, mediumFrom: 30 });

    await setTenantRiskBands(
      db.operatorPool,
      { tenantId: tenant.tenantId, highFrom: null, mediumFrom: null },
      staff,
    );
    expect(await policyOf(tenant)).toMatchObject({ highFrom: 60, mediumFrom: 30 });
  });

  it('lifts a signal exception by leaving nothing behind to inherit around', async () => {
    await setTenantRiskSignal(
      db.operatorPool,
      { tenantId: tenant.tenantId, code: 'shared_address', weight: null },
      staff,
    );
    expect((await policyOf(tenant)).signals.shared_address?.weight).toBe(40);
    const { rows } = await db.operatorPool.query(
      `SELECT 1 FROM tenant_risk_signals WHERE tenant_id = $1 AND signal_code = 'shared_address'`,
      [tenant.tenantId],
    );
    expect(rows).toHaveLength(0);
  });

  it('writes the platform changes to the staff trail and the subscriber ones to theirs', async () => {
    const { rows: staffTrail } = await db.operatorPool.query<{ action: string; target: string }>(
      `SELECT action, target FROM operator_audit WHERE action LIKE 'risk.%' ORDER BY at`,
    );
    expect(staffTrail.map((row) => row.action)).toContain('risk.signal_set');
    expect(staffTrail.map((row) => row.action)).toContain('risk.product_set');

    const subscriberTrail = await withTenant(
      db.appPool,
      tenant.tenantId,
      async (tx) =>
        (
          await tx.query<{ action: string }>(
            `SELECT action FROM audit_log WHERE tenant_id = $1 AND action LIKE 'risk.%'`,
            [tx.tenantId],
          )
        ).rows,
    );
    expect(subscriberTrail.map((row) => row.action)).toContain('risk.signal_set');
    expect(subscriberTrail.map((row) => row.action)).toContain('risk.bands_set');
  });
});
