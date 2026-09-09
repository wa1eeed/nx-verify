import type { TenantTransaction } from '@nx-verify/db';

/**
 * The worker runtime.
 *
 * Every job in this app existed before this file did, and nothing ran them. This is the
 * loop: it knows which jobs are due, runs them, and keeps running the others when one of
 * them fails.
 *
 * Two properties are the whole design. A job never runs while its previous run is still
 * going, because a monitor sweep that takes longer than its interval would otherwise pile
 * up copies of itself against the same rows. And a job that throws is recorded and
 * skipped, never allowed to end the loop, because a worker that dies on one subscriber's
 * bad row stops working for every other subscriber too.
 *
 * See ADR-056.
 */

export type JobScope = 'tenant' | 'global';

export interface JobContext {
  /** Present for a tenant scoped job. The transaction already has that tenant in scope. */
  tx: TenantTransaction;
  tenantId: string;
}

export interface JobDefinition {
  name: string;
  everySeconds: number;
  scope: JobScope;
  /** Runs once per active tenant for a tenant scoped job, and once otherwise. */
  run: (context: JobContext) => Promise<void>;
}

export interface SchedulerOptions {
  jobs: JobDefinition[];
  /** The workspaces to walk. Read on the operator connection: see tenants.ts. */
  tenants: () => Promise<string[]>;
  /** Runs a handler with one workspace in scope, the way every job must run. */
  runInTenant: <T>(tenantId: string, handler: (tx: TenantTransaction) => Promise<T>) => Promise<T>;
  now?: () => number;
  /** Reported rather than thrown, so one bad job does not take the worker down. */
  onError?: (job: string, tenantId: string | null, error: unknown) => void;
  /** How often the loop wakes up to see what is due. */
  tickMs?: number;
}

export interface JobRun {
  job: string;
  tenantId: string | null;
  ok: boolean;
}

export class Scheduler {
  readonly #options: SchedulerOptions;
  readonly #dueAt = new Map<string, number>();
  readonly #running = new Set<string>();
  #stopped = false;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: SchedulerOptions) {
    this.#options = options;
    const now = this.#now();
    for (const job of options.jobs) {
      // Everything is due at startup, so a deployment does not wait an interval before
      // the first sweep.
      this.#dueAt.set(job.name, now);
    }
  }

  /** Runs whatever is due right now. Returns what it ran, for tests and for logging. */
  async tick(): Promise<JobRun[]> {
    const runs: JobRun[] = [];
    const now = this.#now();

    for (const job of this.#options.jobs) {
      if (this.#stopped) {
        break;
      }
      if ((this.#dueAt.get(job.name) ?? 0) > now) {
        continue;
      }
      // A run still in flight keeps its own slot. The next tick will find it finished.
      if (this.#running.has(job.name)) {
        continue;
      }

      this.#running.add(job.name);
      try {
        runs.push(...(await this.#runJob(job)));
      } finally {
        this.#running.delete(job.name);
        this.#dueAt.set(job.name, this.#now() + job.everySeconds * 1000);
      }
    }

    return runs;
  }

  async #runJob(job: JobDefinition): Promise<JobRun[]> {
    if (job.scope === 'global') {
      // A global job still runs inside a tenant transaction, because there is no other
      // kind of connection here. It is given the first workspace only when it needs one.
      const tenantIds = await this.#tenants();
      const tenantId = tenantIds[0];
      if (!tenantId) {
        return [];
      }
      return [await this.#runOnce(job, tenantId)];
    }

    const runs: JobRun[] = [];
    for (const tenantId of await this.#tenants()) {
      if (this.#stopped) {
        break;
      }
      runs.push(await this.#runOnce(job, tenantId));
    }
    return runs;
  }

  async #runOnce(job: JobDefinition, tenantId: string): Promise<JobRun> {
    try {
      await this.#options.runInTenant(tenantId, (tx) => job.run({ tx, tenantId }));
      return { job: job.name, tenantId, ok: true };
    } catch (error) {
      // One subscriber's bad row must not stop the sweep for everyone else.
      this.#options.onError?.(job.name, tenantId, error);
      return { job: job.name, tenantId, ok: false };
    }
  }

  async #tenants(): Promise<string[]> {
    try {
      return await this.#options.tenants();
    } catch (error) {
      this.#options.onError?.('tenants', null, error);
      return [];
    }
  }

  start(): void {
    if (this.#timer) {
      return;
    }
    const tickMs = this.#options.tickMs ?? 5_000;
    const loop = () => {
      void this.tick().finally(() => {
        if (!this.#stopped) {
          this.#timer = setTimeout(loop, tickMs);
          // The loop must not hold the process open on its own: a stop that is waiting
          // for a run to finish should still let node exit when it does.
          this.#timer.unref();
        }
      });
    };
    this.#timer = setTimeout(loop, 0);
    this.#timer.unref();
  }

  /** Stops before the next job and lets the one in flight finish. */
  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    while (this.#running.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }
}
