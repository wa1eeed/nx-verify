import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { pageRequestOf, pageWindow, readPage, slicePage } from '../src/pagination.js';
import { verify } from '../src/verification/verify.js';
import { countRecentRuns, pageRecentRuns } from '../src/verification/runs-log.js';
import { apiLogTallies, pageApiRequests, recordApiRequest } from '../src/observability/api-log.js';
import { countQueue, openCase, pageQueue } from '../src/review/queue.js';
import { pageOperatorAudit, recordOperatorAudit } from '../src/operators/audit.js';
import { marginTotals, pageMarginReport } from '../src/billing/margin.js';
import { getLedger, topUp } from '../src/billing/wallet.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';

/**
 * The interface unit: long lists read a page at a time.
 *
 * The page a request names is clamped once the total is known, the rows of every page follow
 * one another without a gap or a repeat, and the figures above a list are counted over the
 * whole list rather than the page on screen.
 */

describe('a page request and its window', () => {
  it('reads the address and falls back to the first page of the default size', () => {
    expect(pageRequestOf({})).toEqual({ page: 1, size: 25 });
    expect(pageRequestOf({ page: '3', size: '50' })).toEqual({ page: 3, size: 50 });
    expect(pageRequestOf({ page: '-2', size: '40' })).toEqual({ page: 1, size: 25 });
    expect(pageRequestOf({ page: 'x', size: '100' })).toEqual({ page: 1, size: 100 });
  });

  it('clamps a page past the end to the last page, and an empty list to one page', () => {
    expect(pageWindow({ page: 9, size: 25 }, 60)).toEqual({
      page: 3,
      pages: 3,
      offset: 50,
      limit: 25,
    });
    expect(pageWindow({ page: 2, size: 25 }, 0)).toEqual({
      page: 1,
      pages: 1,
      offset: 0,
      limit: 25,
    });
  });

  it('slices rows already in memory', () => {
    const page = slicePage(
      Array.from({ length: 60 }, (_, index) => index),
      { page: 2, size: 25 },
    );
    expect(page.rows[0]).toBe(25);
    expect(page.rows).toHaveLength(25);
    expect(page).toMatchObject({ total: 60, page: 2, pages: 3 });
  });

  it('counts before it reads, and reads nothing for an empty list', async () => {
    const calls: string[] = [];
    const empty = await readPage(
      { page: 4, size: 25 },
      async () => {
        calls.push('count');
        return 0;
      },
      async () => {
        calls.push('read');
        return [];
      },
    );
    expect(calls).toEqual(['count']);
    expect(empty).toMatchObject({ rows: [], total: 0, page: 1, pages: 1 });

    const windows: { offset: number; limit: number }[] = [];
    const clamped = await readPage(
      { page: 9, size: 25 },
      async () => 30,
      async (window) => {
        windows.push(window);
        return ['a'];
      },
    );
    expect(windows).toEqual([{ offset: 25, limit: 25 }]);
    expect(clamped.page).toBe(2);
  });
});

describe('pages read from the database', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Paged Co');
    await preparePricedTenant(db, tenant.tenantId, { packageCode: 'ESSENTIAL' });

    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      for (let index = 0; index < 30; index += 1) {
        await recordApiRequest(tx, {
          apiKeyId: null,
          requestId: `req_${String(index).padStart(3, '0')}`,
          method: 'GET',
          route: '/v1/verifications/:id',
          status: index % 6 === 0 ? 500 : 200,
          latencyMs: index,
          environment: 'live',
        });
      }
    });

    for (let index = 0; index < 27; index += 1) {
      await recordOperatorAudit(db.operatorPool, {
        operatorId: 'nx-staff:test',
        action: index % 3 === 0 ? 'staff.updated' : 'pricing.list_price',
        target: index % 3 === 0 ? 'staff:x' : 'pricing:product:CR_FULL',
      });
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('pages the API log without a gap or a repeat, and counts its figures over the whole log', async () => {
    const first = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      pageApiRequests(tx, {}, { page: 1, size: 25 }),
    );
    const second = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      pageApiRequests(tx, {}, { page: 2, size: 25 }),
    );
    expect(first).toMatchObject({ total: 30, pages: 2 });
    expect(first.rows).toHaveLength(25);
    expect(second.rows).toHaveLength(5);
    const ids = [...first.rows, ...second.rows].map((row) => row.requestId);
    expect(new Set(ids).size).toBe(30);
    // Newest first.
    expect(first.rows[0]?.requestId).toBe('req_029');

    const tallies = await withTenant(db.appPool, tenant.tenantId, (tx) => apiLogTallies(tx, {}));
    expect(tallies).toEqual({ total: 30, failures: 5, slowestMs: 29 });
    const failures = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      pageApiRequests(tx, { failuresOnly: true }, { page: 1, size: 25 }),
    );
    expect(failures.total).toBe(5);
  });

  it('pages the audit trail by kind of change', async () => {
    const pricing = await pageOperatorAudit(
      db.operatorPool,
      { actionPrefixes: ['pricing.'] },
      { page: 1, size: 25 },
    );
    expect(pricing.total).toBe(18);
    expect(pricing.rows.every((row) => row.action.startsWith('pricing.'))).toBe(true);

    const everything = await pageOperatorAudit(db.operatorPool, {}, { page: 2, size: 25 });
    expect(everything).toMatchObject({ total: 27, page: 2 });
    expect(everything.rows).toHaveLength(2);
  });

  it('counts runs and cases over the whole list, and the overdue ones apart', async () => {
    const runIds: { runId: string; entityId: string }[] = [];
    for (const unn of ['7001272184', '7001272186', '7001272187']) {
      const result = await withTenant(db.appPool, tenant.tenantId, (tx) =>
        verify(tx, {
          productCode: 'ADDRESS_ONLY',
          subject: { unn },
          subjectIdentifiers: [{ idType: 'UNN', value: unn }],
          idempotencyKey: randomUUID(),
          triggeredBy: 'API',
          runStep: fixture.runnerFor(tx),
          keys,
        }),
      );
      runIds.push({ runId: result.runId, entityId: result.entityId ?? '' });
    }

    const runs = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      pageRecentRuns(tx, {}, { page: 7, size: 25 }),
    );
    expect(runs.page).toBe(1);
    expect(runs.total).toBe(
      await withTenant(db.appPool, tenant.tenantId, (tx) => countRecentRuns(tx, {})),
    );
    expect(runs.rows.length).toBe(runs.total);

    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      for (const run of runIds) {
        await openCase(tx, { entityId: run.entityId, runId: run.runId, reasonCodes: ['TEST'] });
      }
      await tx.query(
        `UPDATE review_cases SET sla_due_at = now() - interval '1 hour'
         WHERE tenant_id = $1 AND run_id = $2`,
        [tx.tenantId, runIds[0]?.runId],
      );
    });
    const queue = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      pageQueue(tx, {}, { page: 1, size: 25 }),
    );
    expect(queue.total).toBe(3);
    expect(queue.rows[0]?.overdue).toBe(true);
    const overdue = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      countQueue(tx, { overdueOnly: true }),
    );
    expect(overdue).toBe(1);
  });

  it('keeps the wallet ledger in the order it was written past ten entries', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      for (let index = 0; index < 12; index += 1) {
        await topUp(tx, { amount: 100_00 + index, vatInvoiceId: `INV-ORDER-${index}` });
      }
    });
    const ledger = await withTenant(db.appPool, tenant.tenantId, (tx) => getLedger(tx));
    const ids = ledger.map((entry) => Number(entry.id));
    // Read as text, entry 10 would come before entry 2.
    expect(ids).toEqual([...ids].sort((left, right) => left - right));
    expect(ledger.length).toBeGreaterThanOrEqual(12);
  });

  it('pages the margin report and totals it over every row', async () => {
    const report = await pageMarginReport(db.operatorPool, {}, { page: 1, size: 25 });
    const totals = await marginTotals(db.operatorPool);
    expect(report.total).toBeGreaterThanOrEqual(1);
    expect(totals.billedHalalas).toBe(report.rows.reduce((sum, row) => sum + row.billedHalalas, 0));
  });
});
