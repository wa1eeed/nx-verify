import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  HEARTBEAT_STALE_SECONDS,
  beat,
  heartbeatPath,
  isAlive,
  secondsSinceBeat,
} from '../src/heartbeat.js';
import { Scheduler } from '../src/schedule.js';

/**
 * Telling a quiet worker from a dead one (SEC-07).
 *
 * The worker used to exit with a zero after its first sweep and nothing said so: the jobs
 * that destroy data on time, deliver callbacks and watch for changes simply stopped. The loop
 * was fixed; this is what makes the next such silence visible within a minute and a half.
 */

const directory = mkdtempSync(join(tmpdir(), 'nx-heartbeat-'));
const path = join(directory, 'beat');

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('the worker heartbeat', () => {
  it('is nothing until the first sweep, and a moment in time after it', () => {
    expect(secondsSinceBeat(path)).toBeNull();
    expect(isAlive(path)).toBe(false);
    expect(beat(path)).toBe(true);
    expect(secondsSinceBeat(path) ?? 99).toBeLessThan(1);
    expect(isAlive(path)).toBe(true);
  });

  it('counts a worker stopped once its last sweep is old enough', () => {
    const swept = new Date('2026-09-16T09:00:00Z');
    beat(path, swept);
    const soon = new Date(swept.getTime() + (HEARTBEAT_STALE_SECONDS - 5) * 1000);
    const late = new Date(swept.getTime() + (HEARTBEAT_STALE_SECONDS + 5) * 1000);
    expect(isAlive(path, soon)).toBe(true);
    expect(isAlive(path, late)).toBe(false);
    expect(Math.round(secondsSinceBeat(path, late) ?? 0)).toBe(HEARTBEAT_STALE_SECONDS + 5);
  });

  it('never throws, whatever the path is', () => {
    expect(beat('/this/directory/does/not/exist/beat')).toBe(false);
    expect(secondsSinceBeat('/this/directory/does/not/exist/beat')).toBeNull();
  });

  it('is off unless a deployment asks for it', () => {
    expect(heartbeatPath({})).toBeNull();
    expect(heartbeatPath({ NX_WORKER_HEARTBEAT: '  ' })).toBeNull();
    expect(heartbeatPath({ NX_WORKER_HEARTBEAT: '/tmp/beat' })).toBe('/tmp/beat');
  });

  it('marks a sweep that had nothing to do, which is the whole point', async () => {
    let beats = 0;
    const scheduler = new Scheduler({
      jobs: [],
      tenants: () => Promise.resolve([]),
      runInTenant: (_tenantId, handler) => handler(undefined as never),
      onTick: () => {
        beats += 1;
      },
    });
    // No jobs at all: a worker with nothing due looks exactly like a worker that has died,
    // and the difference is that this one still goes round.
    expect(await scheduler.tick()).toEqual([]);
    await scheduler.tick();
    expect(beats).toBe(2);
  });
});
