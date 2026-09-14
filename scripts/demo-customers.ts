import { randomUUID } from 'node:crypto';
import { createPool, withTenant } from '../packages/db/src/client.js';
import { DerivedTenantKeyProvider, masterKeySourceFromEnv } from '../packages/core/src/index.js';
import { runChecks } from '../packages/core/src/customers/checks.js';
import { resolveProviders } from '../packages/core/src/routing/provider-routing.js';
import {
  createProviderStepRunner,
  registryFor,
  resolveCredential,
  secretStoreFromEnv,
} from '../packages/providers/src/index.js';
import {
  SANDBOX_FREELANCER,
  SANDBOX_IBAN,
  SANDBOX_UNN,
} from '../packages/providers/src/stub/verification-sandbox.js';

/**
 * Fills a workspace with customers from the published test data, through the same path a
 * click in the console takes, so a demonstration shows files that were verified rather than
 * rows that were inserted.
 *
 *   pnpm tsx scripts/demo-customers.ts <tenant id>
 *
 * Only against a workspace whose connection answers from test data. It refuses to guess.
 */
async function main(): Promise<void> {
  const tenantId = process.argv[2];
  if (!tenantId) {
    throw new Error('usage: tsx scripts/demo-customers.ts <tenant id>');
  }
  const pool = createPool(process.env['NX_APP_DATABASE_URL'] ?? '');
  const keys = new DerivedTenantKeyProvider(masterKeySourceFromEnv());
  const secrets = secretStoreFromEnv();
  try {
    const sandbox = await withTenant(pool, tenantId, async (tx) => {
      const { rows } = await tx.query<{ is_sandbox: boolean }>(
        `SELECT sandbox_of IS NOT NULL AS is_sandbox FROM tenants WHERE id = $1`,
        [tenantId],
      );
      return rows[0]?.is_sandbox ?? false;
    });
    const registry = await withTenant(pool, tenantId, (tx) =>
      registryFor(tx, sandbox ? 'sandbox' : 'live'),
    );
    const deps = {
      inTenant: <T>(work: (tx: Parameters<typeof resolveProviders>[0]) => Promise<T>) =>
        withTenant(pool, tenantId, work),
      keys,
      runStepFor: (tx: Parameters<typeof resolveProviders>[0]) =>
        createProviderStepRunner({
          registry,
          candidatesFor: (step) =>
            resolveProviders(tx, {
              endpoint: step.endpoint,
              declaredProvider: step.provider,
              declaredFallback: step.fallbackProvider,
            }),
          credentialFor: (name, ref) => resolveCredential(tx, secrets, name, ref),
        }),
    };

    const plans = [
      {
        kind: 'BUSINESS' as const,
        identity: { unn: SANDBOX_UNN.ACTIVE },
        checks: [
          'CR_FULL',
          'ARTICLES_OF_ASSOCIATION',
          'MANAGER_AUTHORITY',
          'NATIONAL_ADDRESS',
          'IBAN_VERIFICATION',
        ],
        iban: SANDBOX_IBAN.MATCH,
      },
      {
        kind: 'BUSINESS' as const,
        identity: { unn: SANDBOX_UNN.SUSPENDED },
        checks: ['CR_FULL', 'NATIONAL_ADDRESS', 'IBAN_VERIFICATION'],
        iban: SANDBOX_IBAN.MATCH,
      },
      {
        kind: 'BUSINESS' as const,
        identity: { unn: SANDBOX_UNN.ESTABLISHMENT },
        checks: ['CR_FULL', 'ARTICLES_OF_ASSOCIATION', 'NATIONAL_ADDRESS'],
        iban: undefined,
      },
      {
        kind: 'BUSINESS' as const,
        identity: { unn: SANDBOX_UNN.IN_LIQUIDATION },
        checks: ['CR_FULL'],
        iban: undefined,
      },
      {
        kind: 'FREELANCER' as const,
        identity: {
          nationalId: SANDBOX_FREELANCER.NATIONAL_ID,
          certificateNumber: SANDBOX_FREELANCER.ACTIVE,
        },
        checks: ['FREELANCE_CERTIFICATE', 'IBAN_VERIFICATION'],
        iban: SANDBOX_IBAN.OTHER_NAME,
      },
    ];

    for (const plan of plans) {
      const result = await runChecks(deps, {
        kind: plan.kind,
        identity: plan.identity,
        productCodes: plan.checks,
        ...(plan.iban ? { inputs: { iban: plan.iban } } : {}),
        bundleKey: randomUUID(),
        requestedBy: null,
      });
      console.log(
        result.entityId,
        result.outcomes.map((outcome) => `${outcome.productCode}:${outcome.status}`).join(' '),
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
