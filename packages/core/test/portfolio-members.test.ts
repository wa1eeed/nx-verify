import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import {
  addToPortfolio,
  createPortfolio,
  removeFromPortfolio,
} from '../src/portfolios/portfolios.js';
import { createMonitor } from '../src/monitoring/monitors.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * Leaving a group, and joining it again (ADR-176).
 *
 * Joining a group that watches its members starts a monitor that re-verifies that customer
 * on a cadence and bills the workspace for every run. The consent for that spending is the
 * membership and nothing else, so what is pinned here is that the spending ends when the
 * membership does, that it ends for this group's monitor only, and that changing your mind
 * twice leaves one monitor rather than a row per attempt.
 */

const OPERATOR = 'user:risk-lead';

describe('a membership starts and stops the monitoring it consented to', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let entityId: string;
  let watched: string;
  let plain: string;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Membership Tenant');
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

    const groups = await withTenant(db.appPool, tenant.tenantId, async (tx) => ({
      watched: await createPortfolio(tx, {
        code: 'WATCHED_MEMBERS',
        nameAr: 'مجموعة مراقبة',
        nameEn: 'Watched',
        defaultProductCode: 'KYB_COMPLETE',
        monitorByDefault: true,
        monitorCadence: 'WEEKLY',
        monitorBudget: 300_00,
      }),
      plain: await createPortfolio(tx, {
        code: 'PLAIN_MEMBERS',
        nameAr: 'مجموعة بلا مراقبة',
        nameEn: 'Plain',
      }),
    }));
    watched = groups.watched;
    plain = groups.plain;
  });

  afterAll(async () => {
    await db.close();
  });

  const monitorsFor = async (consentRef: string): Promise<{ id: string; status: string }[]> =>
    withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const { rows } = await tx.query<{ id: string; status: string }>(
        `SELECT id, status FROM monitors
         WHERE tenant_id = $1 AND entity_id = $2 AND consent_ref = $3
         ORDER BY created_at`,
        [tx.tenantId, entityId, consentRef],
      );
      return rows;
    });

  it('says a group that watches nobody watches nobody', async () => {
    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      addToPortfolio(tx, plain, entityId, OPERATOR),
    );

    expect(result.added).toBe(true);
    // Not «running»: a screen reading this prints one sentence per state, and «monitoring
    // started» over a group that starts none is the class of text this change is about.
    expect(result.monitoring).toBeNull();
    expect(result.monitorId).toBeNull();
  });

  it('stops this group monitor when the member leaves, and leaves the others alone', async () => {
    // A monitor on the same customer for a reason of its own: switched on from their file,
    // consented to separately, and no business of this group.
    const ownMonitor = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createMonitor(tx, {
        entityId,
        productCode: 'KYB_COMPLETE',
        fieldPaths: ['cr.status'],
        cadence: 'MONTHLY',
        budgetCapPerPeriod: 100_00,
        activatedBy: OPERATOR,
        consentRef: 'customer-file',
      }),
    );

    const joined = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      addToPortfolio(tx, watched, entityId, OPERATOR),
    );
    expect(joined.monitoring).toBe('running');

    const left = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      removeFromPortfolio(tx, watched, entityId, OPERATOR),
    );

    expect(left).toEqual({ removed: true, monitorsStopped: 1 });

    // Paused, not deleted: who switched it on and what it spent are what an audit asks for,
    // and a delete answers none of it.
    const groupMonitors = await monitorsFor(`portfolio:${watched}`);
    expect(groupMonitors).toHaveLength(1);
    expect(groupMonitors[0]?.status).toBe('paused');

    const untouched = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM monitors WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, ownMonitor],
      );
      return rows[0]?.status;
    });
    expect(untouched).toBe('active');
  });

  it('brings the same monitor back when the customer joins again', async () => {
    const rejoined = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      addToPortfolio(tx, watched, entityId, OPERATOR),
    );

    expect(rejoined.added).toBe(true);
    expect(rejoined.monitoring).toBe('running');

    // One monitor, not one per time somebody changed their mind. Two rows watching one
    // customer under one consent are two bills waiting to happen.
    const groupMonitors = await monitorsFor(`portfolio:${watched}`);
    expect(groupMonitors).toHaveLength(1);
    expect(groupMonitors[0]?.status).toBe('active');
    expect(rejoined.monitorId).toBe(groupMonitors[0]?.id);
  });

  it('records no removal when there was no membership to remove', async () => {
    const before = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const { rows } = await tx.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_log
         WHERE tenant_id = $1 AND action = 'portfolio.member_removed'`,
        [tx.tenantId],
      );
      return rows[0]?.count;
    });

    const nothing = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      // A member of the watching group, asked to be removed from the other one.
      removeFromPortfolio(tx, plain, entityId, OPERATOR),
    );
    expect(nothing.removed).toBe(true);

    const second = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      removeFromPortfolio(tx, plain, entityId, OPERATOR),
    );
    expect(second).toEqual({ removed: false, monitorsStopped: 0 });

    const after = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const { rows } = await tx.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_log
         WHERE tenant_id = $1 AND action = 'portfolio.member_removed'`,
        [tx.tenantId],
      );
      return rows[0]?.count;
    });

    // One line for the one removal that happened. An audit line for an act that did not
    // take place is a false record of an event.
    expect(Number(after)).toBe(Number(before) + 1);
  });
});
