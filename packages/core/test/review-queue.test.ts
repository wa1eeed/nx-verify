import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import {
  approveCase,
  assignCase,
  decideCase,
  listQueue,
  queueStats,
  returnCase,
} from '../src/review/queue.js';
import { readAudit } from '../src/auth/audit.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * The review queue, and the control that makes it worth having.
 */

const ANALYST = 'user:analyst-1';
const APPROVER = 'user:manager-1';

describe('the review queue', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  const runReviewable = async (unn: string): Promise<string> => {
    // A record with no address goes to REVIEW under the default ruleset.
    const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'KYB_COMPLETE',
        subject: { unn },
        subjectIdentifiers: [{ idType: 'UNN', value: unn }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );
    expect(result.decision?.outcome).toBe('REVIEW');
    return result.runId;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Review Tenant');
    await preparePricedTenant(db.appPool, tenant.tenantId, { balanceHalalas: 5_000_00 });
  });

  afterAll(async () => {
    await db.close();
  });

  it('opens a case for every REVIEW decision, carrying the reason', async () => {
    await runReviewable('7000000003');

    const queue = await withTenant(db.appPool, tenant.tenantId, (tx) => listQueue(tx));
    expect(queue.length).toBeGreaterThan(0);
    // The reason travels with the case, so the queue is readable without joining back to
    // a run whose rules may since have changed.
    expect(queue[0]?.reasonCodes.length).toBeGreaterThan(0);
    expect(queue[0]?.status).toBe('OPEN');
  });

  it('does not stack a second case for the same run', async () => {
    const runId = await runReviewable('7000000003');
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) => listQueue(tx));

    // Re-recording the same outcome must not put a second item on an analyst's queue.
    const { openCase } = await import('../src/review/queue.js');
    const second = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      openCase(tx, { entityId: before[0]?.entityId ?? '', runId, reasonCodes: ['X'] }),
    );

    expect(second).toBeNull();
  });

  it('runs a case through assignment, decision and approval', async () => {
    await runReviewable('7000000003');
    const queue = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listQueue(tx, { status: 'OPEN' }),
    );
    const caseId = queue[0]?.caseId ?? '';

    await withTenant(db.appPool, tenant.tenantId, (tx) => assignCase(tx, caseId, ANALYST));
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      decideCase(tx, {
        caseId,
        outcome: 'PASS',
        decidedBy: ANALYST,
        note: 'العنوان الوطني مقدّم من العميل خارج المنصة، وتم التحقق منه يدوياً.',
      }),
    );

    const awaiting = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listQueue(tx, { status: 'AWAITING_APPROVAL' }),
    );
    expect(awaiting.some((item) => item.caseId === caseId)).toBe(true);

    await withTenant(db.appPool, tenant.tenantId, (tx) => approveCase(tx, caseId, APPROVER));

    const closed = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listQueue(tx, { status: 'CLOSED' }),
    );
    expect(closed.some((item) => item.caseId === caseId)).toBe(true);
  });

  it('refuses an approval from the person who decided', async () => {
    await runReviewable('7000000003');
    const queue = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listQueue(tx, { status: 'OPEN' }),
    );
    const caseId = queue[0]?.caseId ?? '';

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      decideCase(tx, {
        caseId,
        outcome: 'FAIL',
        decidedBy: ANALYST,
        note: 'المنشأة لم تقدّم المستندات المطلوبة.',
      }),
    );

    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) => approveCase(tx, caseId, ANALYST)),
    ).rejects.toMatchObject({ code: 'NX-4031' });
  });

  it('refuses four eyes at the database level, not only in the service', async () => {
    await runReviewable('7000000003');
    const queue = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listQueue(tx, { status: 'OPEN' }),
    );
    const caseId = queue[0]?.caseId ?? '';

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      decideCase(tx, { caseId, outcome: 'PASS', decidedBy: ANALYST, note: 'مقبول.' }),
    );

    // A control that lives only in application code is a control a hotfix removes.
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        tx.query(
          `UPDATE review_cases SET approved_by = decided_by, approved_at = now() WHERE id = $1`,
          [caseId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a decision with no written reason', async () => {
    await runReviewable('7000000003');
    const queue = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listQueue(tx, { status: 'OPEN' }),
    );
    const caseId = queue[0]?.caseId ?? '';

    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        decideCase(tx, { caseId, outcome: 'PASS', decidedBy: ANALYST, note: '   ' }),
      ),
      // A decision with no stated reason cannot be reviewed later, which is the point of
      // recording it at all.
    ).rejects.toMatchObject({ code: 'NX-4001' });
  });

  it('sends a case back with the reason it was returned', async () => {
    await runReviewable('7000000003');
    const queue = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listQueue(tx, { status: 'OPEN' }),
    );
    const caseId = queue[0]?.caseId ?? '';

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      decideCase(tx, { caseId, outcome: 'PASS', decidedBy: ANALYST, note: 'مقبول.' }),
    );
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      returnCase(tx, caseId, APPROVER, 'المستند المرفق لا يثبت العنوان'),
    );

    const reopened = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listQueue(tx, { status: 'OPEN' }),
    );
    const item = reopened.find((entry) => entry.caseId === caseId);
    expect(item?.outcome).toBeNull();
    expect(item?.decidedBy).toBeNull();
  });

  it('records who did what, so the queue itself is auditable', async () => {
    const entries = await withTenant(db.appPool, tenant.tenantId, (tx) => readAudit(tx));
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('review.decided');
    expect(actions).toContain('review.approved');
    expect(actions).toContain('review.returned');
  });

  it('ages cases and reports the ones that are late', async () => {
    await runReviewable('7000000003');

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(`UPDATE review_cases SET sla_due_at = now() - interval '2 hours'
                WHERE status = 'OPEN'`),
    );

    const queue = await withTenant(db.appPool, tenant.tenantId, (tx) => listQueue(tx));
    // Overdue first. A queue is managed by what is late, not by what arrived last.
    expect(queue[0]?.overdue).toBe(true);
    expect(queue[0]?.ageHours).toBeGreaterThanOrEqual(0);

    const stats = await withTenant(db.appPool, tenant.tenantId, (tx) => queueStats(tx));
    expect(stats.overdue).toBeGreaterThan(0);
    expect(stats.closed).toBeGreaterThan(0);
    // The number that goes on the monthly report.
    expect(stats.medianHoursToClose).not.toBeNull();
  });

  it('keeps one tenant queue invisible to another', async () => {
    const other = await seedTenant(db.appPool, 'Review Other Tenant');
    const queue = await withTenant(db.appPool, other.tenantId, (tx) => listQueue(tx));
    expect(queue).toEqual([]);
  });
});
