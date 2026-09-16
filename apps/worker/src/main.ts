import { createPool, withTenant, withoutTenant } from '@nx-verify/db';
import {
  DerivedTenantKeyProvider,
  masterKeySourceFromEnv,
  type TenantKeyProvider,
} from '@nx-verify/core';
import {
  createProviderRegistry,
  createProviderStepRunner,
  providerConfigFromEnv,
  registryFor,
  resolveCredential,
  secretStoreFromEnv,
  type ProviderRegistry,
} from '@nx-verify/providers';
import { resolveProviders } from '@nx-verify/core';
import { Scheduler, type JobDefinition } from './schedule.js';
import { beat, heartbeatPath } from './heartbeat.js';
import { activeTenantIds } from './tenants.js';
import { runDueMonitors } from './jobs/monitors.js';
import { resumeAwaitingRuns } from './jobs/resume.js';
import { deliverWebhooks } from './jobs/webhooks.js';
import {
  deliverNotifications,
  HttpMailTransport,
  type MailTransport,
} from './jobs/notifications.js';
import {
  enforceRetention,
  ensureAuditPartitions,
  pruneInboundEvents,
  pruneRequestLogs,
} from './jobs/retention.js';
import { runBatchItems } from './jobs/batches.js';
import { checkProviderHealth } from './jobs/provider-health.js';
import { runVerificationRequests } from './jobs/requests.js';

/**
 * The worker process.
 *
 * Two connections and for the reason in tenants.ts: the operator one lists workspaces and
 * can see nothing else, and the application one does all the work, one workspace at a
 * time. Everything else here is wiring, and every piece of it is a seam that a deployment
 * chooses: the provider registry, the key source, the secret store and the mail transport.
 */

const MINUTE = 60;

async function main(): Promise<void> {
  const appUrl = required('NX_APP_DATABASE_URL');
  const operatorUrl = required('NX_OPERATOR_DATABASE_URL');

  const appPool = createPool(appUrl);
  const operatorPool = createPool(operatorUrl);
  /**
   * The only role that may delete.
   *
   * Separate on purpose, and the retention job runs as it. Wiring that job to the
   * application role makes the database refuse it on every sweep, and the scheduler
   * swallows the error the way it is meant to, so the promise that a customer's data is
   * destroyed after the agreed period stops running and nothing says so.
   */
  const retentionUrl = process.env['NX_RETENTION_DATABASE_URL'];
  const retentionPool = retentionUrl ? createPool(retentionUrl) : null;
  if (!retentionPool) {
    // Said once, loudly, at startup rather than quietly on every sweep.
    console.warn(
      JSON.stringify({
        level: 'warn',
        message:
          'NX_RETENTION_DATABASE_URL is not set, so retention will not run and nothing will be destroyed',
      }),
    );
  }

  const secrets = secretStoreFromEnv();
  const registry = createProviderRegistry(providerConfigFromEnv(process.env));
  const keys: TenantKeyProvider = new DerivedTenantKeyProvider(masterKeySourceFromEnv());
  const mail: MailTransport | null = process.env['NX_MAIL_ENDPOINT']
    ? HttpMailTransport.fromEnv()
    : null;

  // The same routing chain the API uses: the subscriber's bindings first, the product's
  // declaration last. A monitor must not take a different path to a provider than the
  // verification it repeats.
  const stepRunnerFor = (tx: Parameters<JobDefinition['run']>[0]['tx']) =>
    createProviderStepRunner({
      registry,
      candidatesFor: (step) =>
        resolveProviders(tx, {
          endpoint: step.endpoint,
          declaredProvider: step.provider,
          declaredFallback: step.fallbackProvider,
        }),
      credentialFor: (name, ref) => resolveCredential(tx, secrets, name, ref),
    });

  // The connections the administration panel set, per world, held for a minute like the API
  // and the console hold them.
  const registries = new Map<
    'sandbox' | 'live',
    { registry: ProviderRegistry; expiresAt: number }
  >();
  const panelRegistryFor = async (environment: 'sandbox' | 'live'): Promise<ProviderRegistry> => {
    const cached = registries.get(environment);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.registry;
    }
    const built = await withoutTenant(appPool, (tx) => registryFor(tx, environment));
    registries.set(environment, { registry: built, expiresAt: Date.now() + 60_000 });
    return built;
  };

  const jobs: JobDefinition[] = [
    {
      name: 'monitors',
      everySeconds: 15 * MINUTE,
      scope: 'tenant',
      run: async ({ tx }) => {
        await runDueMonitors(tx, { keys, runStep: stepRunnerFor(tx) });
      },
    },
    {
      // Often, and cheaply: a run that is waiting is a customer waiting, and the query
      // touches only that tenant's open waits.
      name: 'resume',
      everySeconds: 30,
      scope: 'tenant',
      run: async ({ tx }) => {
        await resumeAwaitingRuns(tx, { keys, runStep: stepRunnerFor(tx) });
      },
    },
    {
      name: 'webhooks',
      everySeconds: 30,
      scope: 'tenant',
      run: async ({ tx }) => {
        await deliverWebhooks(tx, {
          secrets,
          deliver: async (url, body, headers) => {
            const response = await fetch(url, { method: 'POST', body, headers });
            return { ok: response.ok, status: response.status };
          },
        });
      },
    },
    {
      // Often: a request left behind is a row on somebody's screen still saying «قيد المعالجة».
      name: 'verification-requests',
      everySeconds: 30,
      scope: 'tenant',
      run: async ({ tx, tenantId }) => {
        await runVerificationRequests(tx, {
          keys,
          secrets,
          registryFor: panelRegistryFor,
          inTenant: (work) => withTenant(appPool, tenantId, work),
        });
      },
    },
    {
      name: 'batches',
      everySeconds: MINUTE,
      scope: 'tenant',
      run: async ({ tx }) => {
        await runBatchItems(tx, { keys, runStep: stepRunnerFor(tx) });
      },
    },
    {
      name: 'retention',
      everySeconds: 6 * 60 * MINUTE,
      scope: 'tenant',
      // Deleting, so it runs as the one role that may.
      role: 'retention',
      run: async ({ tx }) => {
        await enforceRetention(tx);
        // The request log is cleared on the same sweep but by its own rule.
        await pruneRequestLogs(tx);
      },
    },
    {
      // Provider callbacks carry no tenant, so this sweep carries none either.
      name: 'inbound-events',
      everySeconds: 24 * 60 * MINUTE,
      scope: 'global',
      role: 'retention',
      run: async ({ tx }) => {
        await pruneInboundEvents(tx);
      },
    },
    {
      name: 'audit-partitions',
      everySeconds: 24 * 60 * MINUTE,
      scope: 'global',
      run: async ({ tx }) => {
        await ensureAuditPartitions(tx);
      },
    },
    {
      name: 'provider-health',
      everySeconds: 5 * MINUTE,
      scope: 'tenant',
      run: async ({ tx }) => {
        await checkProviderHealth(tx, { registry, secrets });
      },
    },
  ];

  if (mail) {
    jobs.push({
      name: 'notifications',
      everySeconds: MINUTE,
      scope: 'tenant',
      run: async ({ tx }) => {
        await deliverNotifications(tx, { transport: mail });
      },
    });
  }

  // Touched after every sweep, so the container can tell a quiet worker from a dead one
  // without opening a port on it (SEC-07).
  const heartbeat = heartbeatPath();

  const scheduler = new Scheduler({
    jobs,
    tenants: () => activeTenantIds(operatorPool),
    runInTenant: (tenantId, handler) => withTenant(appPool, tenantId, handler),
    ...(retentionPool
      ? {
          runInTenantAsRetention: <T>(
            tenantId: string,
            handler: (tx: Parameters<JobDefinition['run']>[0]['tx']) => Promise<T>,
          ) => withTenant(retentionPool, tenantId, handler),
        }
      : {}),
    ...(heartbeat === null ? {} : { onTick: () => void beat(heartbeat) }),
    // The job name and the workspace, never the row that failed: a worker log is a place
    // an identifier must not reach (rule 4).
    onError: (job, tenantId, error) => {
      console.error(
        JSON.stringify({
          level: 'error',
          job,
          tenant_id: tenantId,
          message: error instanceof Error ? error.message : 'job failed',
        }),
      );
    },
  });

  scheduler.start();
  console.error(
    JSON.stringify({
      level: 'info',
      message: 'worker started',
      jobs: jobs.length,
      heartbeat: heartbeat !== null,
    }),
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.error(JSON.stringify({ level: 'info', message: 'stopping', signal }));
    // Let the run in flight finish rather than killing a delivery halfway.
    await scheduler.stop();
    await Promise.all([appPool.end(), operatorPool.end()]);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

void main();
