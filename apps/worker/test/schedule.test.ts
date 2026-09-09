import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { Scheduler, type JobDefinition } from '../src/schedule.js';
import { activeTenantIds } from '../src/tenants.js';

/**
 * Unit 30 acceptance: the jobs actually run, one workspace at a time.
 *
 * The jobs all existed before this and nothing ran them. What is proven here is the loop
 * around them: that a job runs once per workspace under that workspace's own scope, that
 * one failing subscriber does not stop the sweep for the others, that a slow job does not
 * pile up against itself, and that stopping lets the run in flight finish.
 */

describe('the worker scheduler', () => {
  let db: TestDatabase;
  let alpha: SeededTenant;
  let beta: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    alpha = await seedTenant(db.appPool, 'Alpha');
    beta = await seedTenant(db.appPool, 'Beta');
  });

  afterAll(async () => {
    await db.close();
  });

  const build = (jobs: JobDefinition[], overrides: { now?: () => number } = {}) =>
    new Scheduler({
      jobs,
      tenants: () => activeTenantIds(db.operatorPool),
      runInTenant: (tenantId, handler) => withTenant(db.appPool, tenantId, handler),
      ...overrides,
    });

  it('lists workspaces on the operator connection, and only workspaces', async () => {
    const ids = await activeTenantIds(db.operatorPool);
    expect(ids).toContain(alpha.tenantId);
    expect(ids).toContain(beta.tenantId);

    // The same query on the application connection sees nothing, because that role has
    // no way to cross a subscriber boundary. That is the point of using the other one.
    const { rows } = await db.appPool.query<{ id: string }>('SELECT id FROM tenants');
    expect(rows).toEqual([]);
  });

  it('runs a tenant scoped job once per workspace, each in its own scope', async () => {
    const seen: { tenantId: string; scoped: string }[] = [];
    const scheduler = build([
      {
        name: 'sweep',
        everySeconds: 3600,
        scope: 'tenant',
        run: async ({ tx, tenantId }) => {
          const { rows } = await tx.query<{ tenant: string }>(
            `SELECT current_setting('app.tenant_id', true) AS tenant`,
          );
          seen.push({ tenantId, scoped: rows[0]?.tenant ?? '' });
        },
      },
    ]);

    const runs = await scheduler.tick();
    expect(runs.every((run) => run.ok)).toBe(true);
    expect(seen.map((entry) => entry.tenantId).sort()).toEqual(
      [alpha.tenantId, beta.tenantId].sort(),
    );
    // Every job body ran with its own workspace in scope, which is what makes rule 2 hold
    // in the worker the way it holds in the API.
    for (const entry of seen) {
      expect(entry.scoped).toBe(entry.tenantId);
    }
  });

  it('does not run a job again until its interval has passed', async () => {
    let calls = 0;
    let clock = 1_000_000;
    const scheduler = build(
      [
        {
          name: 'slow',
          everySeconds: 60,
          scope: 'global',
          run: () => {
            calls += 1;
            return Promise.resolve();
          },
        },
      ],
      { now: () => clock },
    );

    await scheduler.tick();
    await scheduler.tick();
    expect(calls).toBe(1);

    clock += 61_000;
    await scheduler.tick();
    expect(calls).toBe(2);
  });

  it('keeps sweeping the other workspaces when one of them fails', async () => {
    const succeeded: string[] = [];
    const errors: { job: string; tenantId: string | null }[] = [];

    const scheduler = new Scheduler({
      jobs: [
        {
          name: 'fragile',
          everySeconds: 3600,
          scope: 'tenant',
          run: ({ tenantId }) => {
            if (tenantId === alpha.tenantId) {
              // One subscriber's bad row. It must not become everyone's outage.
              return Promise.reject(new Error('that row is broken'));
            }
            succeeded.push(tenantId);
            return Promise.resolve();
          },
        },
        {
          name: 'after',
          everySeconds: 3600,
          scope: 'global',
          run: () => {
            succeeded.push('after');
            return Promise.resolve();
          },
        },
      ],
      tenants: () => activeTenantIds(db.operatorPool),
      runInTenant: (tenantId, handler) => withTenant(db.appPool, tenantId, handler),
      onError: (job, tenantId) => errors.push({ job, tenantId }),
    });

    const runs = await scheduler.tick();
    expect(errors).toEqual([{ job: 'fragile', tenantId: alpha.tenantId }]);
    expect(succeeded).toContain(beta.tenantId);
    // And the job after the failing one still ran.
    expect(succeeded).toContain('after');
    expect(runs.filter((run) => !run.ok)).toHaveLength(1);
  });

  it('never starts a job while its previous run is still going', async () => {
    let started = 0;
    let release = (): void => {};
    let announceStart = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      announceStart = resolve;
    });

    const scheduler = build([
      {
        name: 'overlapping',
        everySeconds: 0,
        scope: 'global',
        run: async () => {
          started += 1;
          announceStart();
          await gate;
        },
      },
    ]);

    const first = scheduler.tick();
    await firstStarted;

    // A second tick while the first run is still in flight. A monitor sweep that outlasts
    // its interval must not pile up copies of itself against the same rows.
    await scheduler.tick();
    expect(started).toBe(1);

    release();
    await first;
    await scheduler.tick();
    expect(started).toBe(2);
  });

  it('stops before the next job and lets the one in flight finish', async () => {
    let finished = false;
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const scheduler = build([
      {
        name: 'in-flight',
        everySeconds: 0,
        scope: 'global',
        run: async () => {
          await gate;
          finished = true;
        },
      },
    ]);

    const running = scheduler.tick();
    const stopping = scheduler.stop();
    release();
    await running;
    await stopping;

    expect(finished).toBe(true);
    expect(scheduler.stopped).toBe(true);
    // Nothing runs after a stop.
    expect(await scheduler.tick()).toEqual([]);
  });
});
