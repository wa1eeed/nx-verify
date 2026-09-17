import { createPool, withTenant, withoutTenant } from '@nx-verify/db';
import {
  DerivedTenantKeyProvider,
  bootstrapOwnerFromEnv,
  getMailSettings,
  masterKeySourceFromEnv,
  pruneLoginCodes,
  sweepStanding,
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
  buildMailTransport,
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
import { rotateIdentifierKeys } from './jobs/key-rotation.js';
import { announceExpiries } from './jobs/expiry.js';

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

  /**
   * The first owner of the panel, from the deployment's own variables (ADR-142).
   *
   * A platform put on a server through a deployment tool has no console to run a command in,
   * so the two variables that name the owner are made true here, at every start. Absent
   * variables are not an error: a deployment that makes its owner from the panel's token
   * still works.
   */
  const bootstrapped = await bootstrapOwnerFromEnv(operatorPool);
  if (bootstrapped.outcome === 'skipped' && bootstrapped.reason !== undefined) {
    console.warn(JSON.stringify({ level: 'warn', message: bootstrapped.reason }));
  } else if (bootstrapped.outcome !== 'unchanged') {
    // The outcome and nothing else: never the address and never the password.
    console.warn(JSON.stringify({ level: 'info', message: `panel owner ${bootstrapped.outcome}` }));
  }

  const secrets = secretStoreFromEnv();
  const registry = createProviderRegistry(providerConfigFromEnv(process.env));
  const keys: TenantKeyProvider = new DerivedTenantKeyProvider(masterKeySourceFromEnv());
  /**
   * How mail leaves, read from the panel's settings rather than from this process (ADR-141).
   *
   * Built per sweep and cached on the moment the settings were last changed, so pointing the
   * platform at a mail service, correcting the address it sends from or rotating a key all
   * take effect on the next minute rather than on the next deployment.
   *
   * The environment still answers when nothing has been configured, so a deployment that was
   * set up before the panel could do it keeps sending.
   */
  let cached: { at: number; transport: MailTransport | null } | null = null;
  const mailFor = async (
    tx: Parameters<JobDefinition['run']>[0]['tx'],
  ): Promise<MailTransport | null> => {
    const settings = await getMailSettings(tx);
    const at = settings.updatedAt.getTime();
    if (cached?.at === at) {
      return cached.transport;
    }
    const transport = await buildMailTransport(settings, secrets);
    cached = { at, transport };
    return transport;
  };

  // The same routing chain the API uses: the subscriber's bindings first, the product's
  // declaration last. A monitor must not take a different path to a provider than the
  // verification it repeats.
  const stepRunnerFor = (tx: Parameters<JobDefinition['run']>[0]['tx']) =>
    createProviderStepRunner({
      registry,
      candidatesFor: (step) =>
        resolveProviders(tx, {
          endpoint: step.endpoint,
          productCode: step.productCode,
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
      /**
       * Keeping the customers list honest (ADR-140).
       *
       * Two kinds of row are swept: the ones stamped because a customer was verified again or
       * a change on them was read, and then simply the oldest, so a risk weight or a module
       * changed in the panel reaches every facet within an hour without a staff connection
       * ever writing to a table keyed on somebody's customers.
       *
       * Bounded on purpose. A workspace of fifty thousand is swept over hours rather than in
       * one transaction holding a connection for minutes: the whole point of the table is that
       * nothing ever waits for every customer at once.
       */
      name: 'standing-sweep',
      everySeconds: MINUTE,
      scope: 'tenant',
      run: async ({ tx }) => {
        await sweepStanding(tx, keys, { batch: 200, maxAgeMinutes: 60 });
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
        // And the half finished sign ins: spent or stale after a day, and worth clearing
        // for the same reason as everything else here rather than kept forever (ADR-143).
        await pruneLoginCodes(tx);
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
      // Once a day, and it announces the crossing rather than the state: see jobs/expiry.ts.
      name: 'expiry-alerts',
      everySeconds: 24 * 60 * MINUTE,
      scope: 'tenant',
      run: async ({ tx }) => {
        await announceExpiries(tx, { sinceHours: 24 });
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
      /**
       * The ninety day rotation the blueprint promises, kept by the platform rather than by
       * somebody remembering.
       *
       * It does nothing at all while every row is already on the current key: the claim is one
       * indexed read that returns no rows. The moment a new key version is activated it starts
       * moving rows, five hundred at a time, and stops when there are none left. It runs as the
       * application role, which holds UPDATE on the identifiers and nothing else it needs.
       */
      name: 'key-rotation',
      everySeconds: 60 * MINUTE,
      scope: 'tenant',
      run: async ({ tx }) => {
        await rotateIdentifierKeys(tx, { keys });
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

  jobs.push({
    /**
     * Always registered now, and quiet when nothing is configured.
     *
     * It used not to exist at all without an endpoint in the environment, which meant a
     * deployment that configured mail from the panel would still deliver nothing until
     * somebody restarted the worker.
     */
    name: 'notifications',
    everySeconds: MINUTE,
    scope: 'tenant',
    run: async ({ tx }) => {
      const transport = await mailFor(tx);
      if (transport === null) {
        return;
      }
      await deliverNotifications(tx, { transport });
    },
  });

  if (!process.env['NX_MAIL_ENDPOINT']) {
    // Said once, loudly, like the retention warning above. It is no longer fatal to delivery,
    // because the panel can configure mail, but a deployment with neither is a queue that
    // grows in silence and that is worse than one that fails.
    console.warn(
      JSON.stringify({
        level: 'warn',
        message:
          'no mail is configured in the environment; set it from the panel or messages will queue',
      }),
    );
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
    // Every pool, the retention one included: it was left open, so a stop waited on a
    // connection nobody was going to use.
    await Promise.all(
      [appPool, operatorPool, retentionPool]
        .filter((pool) => pool !== null)
        .map((pool) => pool.end()),
    );
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
