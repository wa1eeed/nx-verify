import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import {
  addToPortfolio,
  createPortfolio,
  listPortfolios,
  membershipsOf,
  removeFromPortfolio,
  resolveRuleset,
  setPortfolioTtl,
} from '../src/portfolios/portfolios.js';
import { getEntityProfile } from '../src/repositories/profile.js';
import { setTenantTtl } from '../src/repositories/freshness.js';
import { listFreshnessPolicy } from '../src/repositories/freshness.js';
import { NxError } from '../src/errors.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * Portfolios, and the third level of policy that ADR-007 promised.
 */

const OPERATOR = 'user:risk-lead';

describe('portfolios carry the policy', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let entityId: string;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Portfolio Tenant');
    await preparePricedTenant(db, tenant.tenantId, { balanceHalalas: 5_000_00 });

    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'KYB_COMPLETE',
        subject: { unn: '7001272184', manager: { id: '1098765432', id_type: 'NATIONAL_ID' } },
        subjectIdentifiers: [{ idType: 'UNN', value: '7001272184' }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );
    entityId = result.entityId ?? '';
  });

  afterAll(async () => {
    await db.close();
  });

  it('groups entities and counts them', async () => {
    const portfolioId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createPortfolio(tx, {
        code: 'MERCHANTS',
        nameAr: 'محفظة التجار',
        nameEn: 'Merchant portfolio',
      }),
    );

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      addToPortfolio(tx, portfolioId, entityId, OPERATOR),
    );

    const portfolios = await withTenant(db.appPool, tenant.tenantId, (tx) => listPortfolios(tx));
    expect(portfolios.find((p) => p.code === 'MERCHANTS')?.memberCount).toBe(1);

    const memberships = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      membershipsOf(tx, entityId),
    );
    expect(memberships.map((entry) => entry.code)).toContain('MERCHANTS');
  });

  it('applies a portfolio retention override over the tenant setting', async () => {
    const portfolioId = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const id = await createPortfolio(tx, {
        code: 'PAYOUTS',
        nameAr: 'محفظة الحوالات',
        nameEn: 'Payout portfolio',
      });
      // The tenant is relaxed about this field. This portfolio is not, and the portfolio
      // is where the purpose lives.
      await setTenantTtl(tx, { fieldPath: 'cr.core', ttlDays: 365, weight: 26 });
      await setPortfolioTtl(tx, id, 'cr.core', 1, 26);
      return id;
    });

    const beforeJoining = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, entityId),
    );
    const before = beforeJoining.find((f) => f.fieldPath === 'cr.core.name');
    expect(before?.ttlDays).toBe(365);

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      addToPortfolio(tx, portfolioId, entityId, OPERATOR),
    );

    const afterJoining = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, entityId),
    );
    const after = afterJoining.find((f) => f.fieldPath === 'cr.core.name');

    // Three levels now: system, then tenant, then portfolio, and the most specific wins.
    expect(after?.ttlDays).toBe(1);
    // The field is due for re-verification a year earlier than it was a moment ago, and
    // not one attestation was written to make that true.
    const daysApart =
      ((before?.effectiveUntil?.getTime() ?? 0) - (after?.effectiveUntil?.getTime() ?? 0)) /
      86_400_000;
    expect(Math.round(daysApart)).toBe(364);
    expect(after?.attestationId).toBe(before?.attestationId);
  });

  it('takes the shortest retention when two portfolios disagree', async () => {
    const relaxed = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const id = await createPortfolio(tx, {
        code: 'RELAXED',
        nameAr: 'محفظة متساهلة',
        nameEn: 'Relaxed portfolio',
      });
      await setPortfolioTtl(tx, id, 'cr.core', 900, 26);
      return id;
    });

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      addToPortfolio(tx, relaxed, entityId, OPERATOR),
    );

    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, entityId),
    );

    // The entity is now in a one day portfolio and a nine hundred day portfolio. If any
    // portfolio says this must be re-checked, it must be. Resolving the other way would
    // silently weaken the stricter policy someone deliberately set.
    expect(profile.find((f) => f.fieldPath === 'cr.core.name')?.ttlDays).toBe(1);
  });

  it('leaves the tenant settings screen showing tenant rows only', async () => {
    const policy = await withTenant(db.appPool, tenant.tenantId, (tx) => listFreshnessPolicy(tx));
    const crCore = policy.find((row) => row.fieldPath === 'cr.core');
    // The portfolio override is a portfolio setting and belongs on the portfolio screen.
    expect(crCore?.ttlDays).toBe(365);
    expect(crCore?.source).toBe('tenant');
  });

  it('lets a portfolio decision ruleset beat the product one', async () => {
    const rulesetId = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO decision_rulesets (tenant_id, code, name_ar, name_en)
         VALUES ($1, 'PAYOUT_STRICT', 'قواعد الحوالات', 'Payout rules')
         RETURNING id`,
        [tenant.tenantId],
      );
      const id = rows[0]?.id ?? '';
      await tx.query(
        `INSERT INTO decision_rules (ruleset_id, seq, condition, outcome, reason_code, reason_ar, reason_en)
         VALUES ($1, 1, '{"op":"always"}'::jsonb, 'FAIL', 'PAYOUT_BLOCKED',
                 'الحوالات موقوفة لهذا الكيان', 'Payouts blocked for this entity')`,
        [id],
      );
      return id;
    });

    const portfolioId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createPortfolio(tx, {
        code: 'BLOCKED',
        nameAr: 'محفظة موقوفة',
        nameEn: 'Blocked portfolio',
        decisionRuleset: rulesetId,
      }),
    );

    const productDefault = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveRuleset(tx, entityId, 'product-default'),
    );
    expect(productDefault).toBe('product-default');

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      addToPortfolio(tx, portfolioId, entityId, OPERATOR),
    );

    const resolved = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolveRuleset(tx, entityId, 'product-default'),
    );
    expect(resolved).toBe(rulesetId);

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      removeFromPortfolio(tx, portfolioId, entityId, OPERATOR),
    );
  });

  it('creates a monitor when an entity joins a portfolio that watches its members', async () => {
    const portfolioId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createPortfolio(tx, {
        code: 'WATCHED',
        nameAr: 'محفظة مراقبة',
        nameEn: 'Watched portfolio',
        defaultProductCode: 'KYB_COMPLETE',
        monitorByDefault: true,
        monitorCadence: 'WEEKLY',
        monitorBudget: 300_00,
      }),
    );

    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      addToPortfolio(tx, portfolioId, entityId, OPERATOR),
    );

    expect(result.monitorId).toBeTruthy();

    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ activated_by: string; consent_ref: string }>(
        `SELECT activated_by, consent_ref FROM monitors WHERE id = $1`,
        [result.monitorId],
      ),
    );

    // Monitoring is never anonymous. The portfolio set the policy; a named person
    // performed the act that applied it here.
    expect(rows[0]?.activated_by).toBe(OPERATOR);
    expect(rows[0]?.consent_ref).toBe(`portfolio:${portfolioId}`);
  });

  it('refuses a watching portfolio with no budget', async () => {
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        createPortfolio(tx, {
          code: 'NO_BUDGET',
          nameAr: 'بلا سقف',
          nameEn: 'No budget',
          monitorByDefault: true,
          monitorCadence: 'DAILY',
        }),
      ),
    ).rejects.toBeInstanceOf(NxError);
  });

  it('does not add the same entity twice', async () => {
    const portfolioId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createPortfolio(tx, { code: 'ONCE', nameAr: 'مرة', nameEn: 'Once' }),
    );

    const first = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      addToPortfolio(tx, portfolioId, entityId, OPERATOR),
    );
    const second = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      addToPortfolio(tx, portfolioId, entityId, OPERATOR),
    );

    expect(first.added).toBe(true);
    expect(second.added).toBe(false);
  });

  it('keeps portfolios inside their tenant', async () => {
    const other = await seedTenant(db.appPool, 'Portfolio Other Tenant');
    const portfolios = await withTenant(db.appPool, other.tenantId, (tx) => listPortfolios(tx));
    expect(portfolios).toEqual([]);
  });
});
