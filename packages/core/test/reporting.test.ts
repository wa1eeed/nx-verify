import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import { buildMonthlyReport, portfolioHealth, riskDashboard } from '../src/reporting/dashboard.js';
import { addToPortfolio, createPortfolio } from '../src/portfolios/portfolios.js';
import { decideCase, listQueue } from '../src/review/queue.js';
import { createUser } from '../src/auth/users.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * The risk dashboard and the monthly report.
 *
 * The most important test in this file is the last one, and it is not about numbers.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('reporting', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Reporting Tenant');
    await preparePricedTenant(db.appPool, tenant.tenantId, { balanceHalalas: 5_000_00 });

    for (const unn of ['7001272184', '7000000003', '7000000000']) {
      await withTenant(db.appPool, tenant.tenantId, (tx) =>
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
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('reports the shape of the portfolio at a glance', async () => {
    const dashboard = await withTenant(db.appPool, tenant.tenantId, (tx) => riskDashboard(tx));

    expect(dashboard.entities).toBeGreaterThan(0);
    const fields =
      dashboard.fieldFreshness.fresh +
      dashboard.fieldFreshness.expiring +
      dashboard.fieldFreshness.expired +
      dashboard.fieldFreshness.permanent;
    expect(fields).toBeGreaterThan(0);
    expect(dashboard.wallet.balance).toBeGreaterThan(0);
  });

  it('counts the review queue and what is late', async () => {
    const dashboard = await withTenant(db.appPool, tenant.tenantId, (tx) => riskDashboard(tx));
    // Two of the three subjects produce incomplete records, which go to review.
    expect(dashboard.reviewQueue.open).toBeGreaterThan(0);
  });

  it('builds the monthly report the risk committee sees', async () => {
    const analystId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createUser(tx, { email: 'a@report.sa', displayName: 'محلل', role: 'ANALYST' }),
    );
    const queue = await withTenant(db.appPool, tenant.tenantId, (tx) => listQueue(tx));
    if (queue[0]) {
      await withTenant(db.appPool, tenant.tenantId, (tx) =>
        decideCase(tx, {
          caseId: queue[0]?.caseId ?? '',
          outcome: 'PASS',
          decidedBy: analystId,
          note: 'تم التحقق يدوياً من المستندات.',
        }),
      );
    }

    const report = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      buildMonthlyReport(tx, new Date()),
    );

    expect(report.verifications.total).toBe(3);
    expect(report.decisions.pass + report.decisions.fail + report.decisions.review).toBe(3);
    expect(report.spend.total).toBeGreaterThan(0);
    expect(report.spend.currency).toBe('SAR');
    expect(report.reviewCases.opened).toBeGreaterThan(0);
  });

  it('counts what stayed current without a single paid re-verification', async () => {
    const nextMonth = new Date();
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

    const report = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      buildMonthlyReport(tx, nextMonth),
    );

    // Nothing was verified next month, so everything still current is current for free.
    // This is the number that makes the free freshness layer visible, and it argues for
    // the platform rather than for more spending.
    expect(report.entitiesCoveredWithoutSpend).toBeGreaterThan(0);
    expect(report.verifications.total).toBe(0);
  });

  it('reports the health of each portfolio', async () => {
    const portfolioId = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createPortfolio(tx, { code: 'MAIN', nameAr: 'المحفظة الرئيسية', nameEn: 'Main' }),
    );

    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ id: string }>(`SELECT id FROM entities WHERE entity_type = 'BUSINESS' LIMIT 2`),
    );
    for (const row of rows) {
      await withTenant(db.appPool, tenant.tenantId, (tx) =>
        addToPortfolio(tx, portfolioId, row.id, 'user:ops'),
      );
    }

    const health = await withTenant(db.appPool, tenant.tenantId, (tx) => portfolioHealth(tx));
    expect(health.find((entry) => entry.code === 'MAIN')?.entities).toBe(rows.length);
  });

  it('shows another tenant nothing', async () => {
    const other = await seedTenant(db.appPool, 'Reporting Other Tenant');
    await preparePricedTenant(db.appPool, other.tenantId);

    const dashboard = await withTenant(db.appPool, other.tenantId, (tx) => riskDashboard(tx));
    const report = await withTenant(db.appPool, other.tenantId, (tx) =>
      buildMonthlyReport(tx, new Date()),
    );

    expect(dashboard.reviewQueue.open).toBe(0);
    expect(report.verifications.total).toBe(0);
  });

  it('has no query anywhere that reports across tenants', () => {
    // Rule 2 in its sharpest form. Internal reporting is the place this rule is usually
    // broken first, because the temptation is a benchmark across customers, and it would
    // break the promise the whole isolation model is sold on.
    const offenders: string[] = [];
    const skip = new Set(['node_modules', '.git', '.next', 'dist', '.turbo', 'coverage']);

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (skip.has(entry)) {
          continue;
        }
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        // Shipped code only. A test may query without a WHERE clause on purpose, to
        // prove that row level security alone keeps the rows apart, and that is the
        // opposite of the mistake this scan is looking for.
        if (
          !/\.ts$/.test(entry) ||
          /\.test\.ts$/.test(entry) ||
          !full.includes(`${'/'}src${'/'}`)
        ) {
          continue;
        }

        const source = readFileSync(full, 'utf8');
        // Every statement that touches a tenant scoped table must constrain tenant_id.
        for (const match of source.matchAll(
          /FROM\s+(entity_profile|attestations|verification_runs|review_cases|change_events|entities)\b[\s\S]{0,400}?`/g,
        )) {
          const statement = match[0];
          if (!statement.includes('tenant_id')) {
            offenders.push(`${relative(REPO_ROOT, full)}: ${match[1]}`);
          }
        }
      }
    };

    walk(join(REPO_ROOT, 'packages'));
    walk(join(REPO_ROOT, 'apps'));

    expect(offenders).toEqual([]);
  });
});
