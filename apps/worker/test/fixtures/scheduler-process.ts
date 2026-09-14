import { Scheduler } from '../../src/schedule.js';

/**
 * A worker process with nothing but a started scheduler, for the test that proves the loop
 * keeps the process alive and lets it go once stopped. No other timer or connection is
 * open, so whether node stays up is the scheduler's doing alone.
 */
const scheduler = new Scheduler({
  jobs: [{ name: 'noop', everySeconds: 60, scope: 'global', run: async () => undefined }],
  tenants: async () => [],
  runInTenant: async () => {
    throw new Error('no workspace in this test');
  },
  tickMs: 20,
});

scheduler.start();
process.stdout.write('started\n');
process.on('SIGTERM', () => {
  void scheduler.stop().then(() => process.stdout.write('stopped\n'));
});
