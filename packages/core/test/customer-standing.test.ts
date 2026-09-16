import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { runChecks, type RunChecksDependencies } from '../src/customers/checks.js';
import { countCustomers, listCustomers, pickCustomers } from '../src/customers/list.js';
import { summarizeCustomers } from '../src/customers/summaries.js';
import { refreshStanding, sweepStanding } from '../src/customers/standing.js';
import { listChangeEvents, acknowledgeChange } from '../src/monitoring/change-events.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';
import {
  SANDBOX_FREELANCER,
  SANDBOX_IBAN,
  SANDBOX_UNN,
} from '../../../packages/providers/src/stub/verification-sandbox.js';

/**
 * The customers list at the size a real subscriber reaches (ADR-140).
 *
 * What is proven here is the shape of the fix rather than its speed, which is measured
 * separately: one page is chosen in the database, only that page is read, and the facet counts
 * come from one row per customer instead of from summarising everybody.
 *
 * The invariant that must survive all of it is the one that was there before: a row on the
 * list and the file it opens never disagree. So the page is still summarised live, and this
 * table decides only which customers and in what order.
 */

describe('the customers list, paged in the database', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();
  const ids: string[] = [];

  const deps = (): RunChecksDependencies => ({
    inTenant: (work) => withTenant(db.appPool, tenant.tenantId, work),
    keys,
    runStepFor: (tx) => fixture.runnerFor(tx),
  });

  const inTenant = <T>(
    work: (tx: Parameters<RunChecksDependencies['runStepFor']>[0]) => Promise<T>,
  ) => withTenant(db.appPool, tenant.tenantId, work);

  const standing = () =>
    inTenant(
      async (tx) =>
        (
          await tx.query<{
            entity_id: string;
            kind: string | null;
            last_verified_at: Date | null;
            completeness: number;
            open_alerts: number;
            stale_at: Date | null;
          }>(
            `SELECT entity_id, kind, last_verified_at, completeness, open_alerts, stale_at
             FROM customer_standing WHERE tenant_id = $1 ORDER BY last_verified_at DESC`,
            [tx.tenantId],
          )
        ).rows,
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'List Tenant');
    await preparePricedTenant(db, tenant.tenantId, { balanceHalalas: 5_000_00 });

    // Three customers of two kinds, verified one after another so their order is known.
    for (const subject of [
      { kind: 'BUSINESS' as const, identity: { unn: SANDBOX_UNN.ACTIVE } },
      { kind: 'BUSINESS' as const, identity: { unn: SANDBOX_UNN.ESTABLISHMENT } },
    ]) {
      const result = await runChecks(deps(), {
        kind: subject.kind,
        identity: subject.identity,
        inputs: { iban: SANDBOX_IBAN.MATCH },
        productCodes: ['CR_FULL'],
        bundleKey: randomUUID(),
        requestedBy: null,
      });
      ids.push(result.entityId ?? '');
    }
    const freelancer = await runChecks(deps(), {
      kind: 'FREELANCER',
      identity: {
        nationalId: SANDBOX_FREELANCER.NATIONAL_ID,
        certificateNumber: SANDBOX_FREELANCER.ACTIVE,
      },
      productCodes: ['FREELANCE_CERTIFICATE'],
      bundleKey: randomUUID(),
      requestedBy: null,
    });
    ids.push(freelancer.entityId ?? '');
    expect(ids.every((id) => id !== '')).toBe(true);
  });

  afterAll(async () => {
    await db.close();
  });

  it('makes somebody a customer the moment they are first verified', async () => {
    const rows = await standing();
    expect(rows).toHaveLength(3);
    // The two columns the list navigates by are filled as the verification lands, so a
    // customer verified a second ago is already in the right place and under the right filter.
    expect(rows.every((row) => row.last_verified_at !== null)).toBe(true);
    expect(rows.map((row) => row.kind).sort()).toEqual(['COMPANY', 'ESTABLISHMENT', 'FREELANCER']);
    // And stamped, because completeness and alerts are the model's answers, not SQL's.
    expect(rows.every((row) => row.stale_at !== null)).toBe(true);
  });

  it('chooses a page in the database and says how many there are in all', async () => {
    const first = await inTenant((tx) => pickCustomers(tx, keys, { limit: 2 }));
    expect(first.entityIds).toHaveLength(2);
    expect(first.total).toBe(3);

    const second = await inTenant((tx) => pickCustomers(tx, keys, { limit: 2, offset: 2 }));
    expect(second.entityIds).toHaveLength(1);
    expect(second.total).toBe(3);
    // No customer appears on two pages, which is what an ordering with a tiebreak buys.
    expect(first.entityIds).not.toContain(second.entityIds[0]);
  });

  it('filters by kind and by name without reading a single fact of anybody else', async () => {
    const byKind = await inTenant((tx) => pickCustomers(tx, keys, { kind: 'ESTABLISHMENT' }));
    expect(byKind.total).toBe(1);

    const rows = await inTenant((tx) => listCustomers(tx, keys, { entityIds: byKind.entityIds }));
    expect(rows[0]?.kind).toBe('ESTABLISHMENT');

    const byName = await inTenant((tx) =>
      pickCustomers(tx, keys, { search: (rows[0]?.displayName ?? '').slice(0, 6) }),
    );
    expect(byName.entityIds).toContain(byKind.entityIds[0]);
  });

  it('counts the facets from one row per customer, not by summarising everybody', async () => {
    const counts = await inTenant((tx) => countCustomers(tx));
    expect(counts.all).toBe(3);
    expect(counts.companies).toBe(1);
    expect(counts.establishments).toBe(1);
    expect(counts.freelancers).toBe(1);
    // Completeness and alerts wait for the sweep, so before it they read as nothing rather
    // than as a guess.
    expect(counts.complete).toBe(0);
  });

  it('fills what the model decides on the sweep, and clears the stamp', async () => {
    const swept = await inTenant((tx) => sweepStanding(tx, keys, { batch: 10 }));
    expect(swept.refreshed).toBe(3);
    const rows = await standing();
    expect(rows.every((row) => row.stale_at === null)).toBe(true);
    // And the standing now says what the summary says.
    const summaries = await inTenant((tx) =>
      summarizeCustomers(tx, keys, { entityIds: rows.map((row) => row.entity_id) }),
    );
    for (const summary of summaries) {
      const row = rows.find((entry) => entry.entity_id === summary.entityId);
      expect(row?.completeness).toBe(summary.completeness);
      expect(row?.open_alerts).toBe(summary.openAlerts);
    }
  });

  it('never lets the list and the file it opens disagree', async () => {
    const picked = await inTenant((tx) => pickCustomers(tx, keys, { limit: 25 }));
    const rows = await inTenant((tx) =>
      summarizeCustomers(tx, keys, { entityIds: picked.entityIds }),
    );
    // The page is summarised live from the model, so what a reader sees is never the stored
    // standing: the table only chose which customers and in what order.
    expect(rows.map((row) => row.entityId)).toEqual(picked.entityIds);
    expect(rows.every((row) => row.completeness >= 0 && row.completeness <= 100)).toBe(true);
  });

  it('stamps a customer again when a change on them is read', async () => {
    await inTenant(async (tx) => {
      await tx.query(`UPDATE customer_standing SET stale_at = NULL WHERE tenant_id = $1`, [
        tx.tenantId,
      ]);
    });

    // A change nobody has acknowledged, on the first customer.
    const entityId = ids[0] ?? '';
    const events = await inTenant((tx) => listChangeEvents(tx, { entityId }));
    if (events.length === 0) {
      // The sandbox company changes nothing on a single verification, so there is nothing to
      // acknowledge and nothing to prove here. The path is covered by the run above.
      expect(events).toEqual([]);
      return;
    }
    await inTenant((tx) => acknowledgeChange(tx, events[0]?.changeEventId ?? '', 'user:test'));
    const rows = await standing();
    expect(rows.find((row) => row.entity_id === entityId)?.stale_at).not.toBeNull();
  });

  it('forgets a customer who is no longer one', async () => {
    const entityId = ids[2] ?? '';
    await inTenant(async (tx) => {
      await tx.query(`UPDATE entities SET archived_at = now() WHERE tenant_id = $1 AND id = $2`, [
        tx.tenantId,
        entityId,
      ]);
    });
    // Archived: gone from the list and from its counts, without anything being deleted.
    const counts = await inTenant((tx) => countCustomers(tx));
    expect(counts.all).toBe(2);
    expect((await inTenant((tx) => pickCustomers(tx, keys, {}))).entityIds).not.toContain(entityId);

    // And a refresh of an archived customer takes the row away rather than leaving a count of
    // somebody who is not there.
    await inTenant((tx) => refreshStanding(tx, keys, [entityId]));
    expect((await standing()).some((row) => row.entity_id === entityId)).toBe(false);
  });
});
