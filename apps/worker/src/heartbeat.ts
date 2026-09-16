import { closeSync, openSync, statSync, utimesSync } from 'node:fs';

/**
 * Whether the worker's loop is still going round (SEC-07).
 *
 * The worker answers no port, and giving it one to prove it is alive would be a new surface
 * on a process that holds the retention role. So it touches a file after every sweep instead,
 * and the container's health check reads how old that file is. Nothing is written into it:
 * the fact is the time, and a worker whose loop has stopped stops changing it.
 *
 * A deployment that does not set the path gets no heartbeat and no health check, which is
 * the right default for a developer running the worker in a terminal.
 */

export const HEARTBEAT_VARIABLE = 'NX_WORKER_HEARTBEAT';

/** How old the file may be before the worker counts as stopped: three tick intervals. */
export const HEARTBEAT_STALE_SECONDS = 90;

export function heartbeatPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const path = env[HEARTBEAT_VARIABLE];
  return path === undefined || path.trim() === '' ? null : path;
}

/** Marks the moment of a sweep. Never throws: a worker must not stop over its own heartbeat. */
export function beat(path: string, now: Date = new Date()): boolean {
  try {
    utimesSync(path, now, now);
    return true;
  } catch {
    try {
      closeSync(openSync(path, 'w'));
      utimesSync(path, now, now);
      return true;
    } catch {
      return false;
    }
  }
}

/** How long ago the last sweep was, in seconds, or null when there has been none. */
export function secondsSinceBeat(path: string, now: Date = new Date()): number | null {
  try {
    return Math.max(0, (now.getTime() - statSync(path).mtimeMs) / 1000);
  } catch {
    return null;
  }
}

export function isAlive(
  path: string,
  now: Date = new Date(),
  staleSeconds: number = HEARTBEAT_STALE_SECONDS,
): boolean {
  const age = secondsSinceBeat(path, now);
  return age !== null && age <= staleSeconds;
}
