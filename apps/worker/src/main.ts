import { createPool, withTenant } from '@nx-verify/db';
import {
  DerivedTenantKeyProvider,
  masterKeySourceFromEnv,
  type TenantKeyProvider,
} from '@nx-verify/core';
import {
  createProviderRegistry,
  createProviderStepRunner,
  providerConfigFromEnv,
  resolveCredential,
  secretStoreFromEnv,
} from '@nx-verify/providers';
import { resolveProviders } from '@nx-verify/core';
import { Scheduler, type JobDefinition } from './schedule.js';
import { activeTenantIds } from './tenants.js';
import { runDueMonitors } from './jobs/monitors.js';
import { deliverWebhooks } from './jobs/webhooks.js';
import { deliverNotifications, HttpMailTransport, type MailTransport } from './jobs/notifications.js';
import { enforceRetention, ensureAuditPartitions } from './jobs/retention.js';
import { runBatchItems } from './jobs/batches.js';
import { checkProviderHealth } from './jobs/provider-health.js';

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
      run: async ({ tx }) => {
        await enforceRetention(tx);
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

  const scheduler = new Scheduler({
    jobs,
    tenants: () => activeTenantIds(operatorPool),
    runInTenant: (tenantId, handler) => withTenant(appPool, tenantId, handler),
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
  console.error(JSON.stringify({ level: 'info', message: 'worker started', jobs: jobs.length }));

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
