import { HEARTBEAT_STALE_SECONDS, heartbeatPath, isAlive, secondsSinceBeat } from './heartbeat.js';

/**
 * The worker's health check, as the container runs it (SEC-07).
 *
 * Exits 0 while the loop is going round and 1 once it has stopped, so a worker that dies
 * quietly is restarted rather than left for somebody to notice weeks later. It opens no port
 * and asks the database nothing: a health check that needs the database calls a worker
 * unhealthy every time the database blinks, and restarting it would not have helped.
 */
const path = heartbeatPath();
if (path === null) {
  console.error(`${'NX_WORKER_HEARTBEAT'} is not set, so there is no heartbeat to read`);
  process.exit(1);
}

const age = secondsSinceBeat(path);
if (isAlive(path)) {
  // Written to the error stream like everything else this process says, so a container's
  // logs read in one order.
  console.error(`worker swept ${Math.round(age ?? 0)}s ago`);
  process.exit(0);
}

console.error(
  age === null
    ? 'the worker has not swept once'
    : `the worker last swept ${Math.round(age)}s ago, over the ${HEARTBEAT_STALE_SECONDS}s it is given`,
);
process.exit(1);
