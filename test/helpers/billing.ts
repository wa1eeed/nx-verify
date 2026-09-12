import { withTenant, withoutTenant } from '../../packages/db/src/client.js';
import type { TestDatabase } from './db.js';
import { applyProductSeed } from '../../packages/db/src/seed/products.js';
import { applyPackageSeed } from '../../packages/db/src/seed/packages.js';
import { openPriceVersion } from '../../packages/core/src/billing/price-book.js';
import { topUp } from '../../packages/core/src/billing/wallet.js';
import { invalidateSchemaCache } from '../../packages/core/src/products/input-validation.js';
import {
  InMemorySecretStore,
  ProviderRegistry,
  StubProvider,
  createProviderStepRunner,
  resolveCredential,
} from '../../packages/providers/src/index.js';
import { resolveProviders } from '../../packages/core/src/routing/provider-routing.js';
import type { TenantTransaction } from '../../packages/db/src/client.js';

export const SECRET_REF = 'kms://tenants/test/providers/stub';

export interface BillingFixture {
  registry: ProviderRegistry;
  secrets: InMemorySecretStore;
  provider: StubProvider;
  runnerFor: (tx: TenantTransaction) => ReturnType<typeof createProviderStepRunner>;
}

export function providerFixture(providerName = 'stub'): BillingFixture {
  const provider = new StubProvider({ name: providerName });
  const registry = new ProviderRegistry().register(provider);
  const secrets = new InMemorySecretStore({ [SECRET_REF]: { apiKey: 'test-key' } });

  return {
    registry,
    secrets,
    provider,
    // The routing resolver is wired in by default, so tests take the same path
    // production does: the subscriber's bindings first, the product's declaration last.
    runnerFor: (tx) =>
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
}

export interface PricedTenantOptions {
  balanceHalalas?: number;
  prices?: {
    productCode: string;
    unitPriceHalalas: number;
    negativePct?: number;
    cachePct?: number;
  }[];
  /** Provider named on every seeded step, and bound for this tenant. */
  providerName?: string;
  /**
   * The package the tenant is put on. Enterprise by default, which is every module with
   * no count limit: a fixture should not make a test fail for a commercial reason it did
   * not ask about.
   */
  packageCode?: string;
}

/**
 * Seeds products and packages, subscribes the tenant, binds a provider, funds the wallet
 * and opens a price list.
 *
 * It takes the whole test database rather than one pool, because the two halves of a real
 * provisioning run are done by two different roles: the operator writes the catalogue and
 * the subscription, and the application writes everything that belongs to the subscriber.
 */
export async function preparePricedTenant(
  db: TestDatabase,
  tenantId: string,
  options: PricedTenantOptions = {},
): Promise<void> {
  const pool = db.appPool;
  const providerName = options.providerName ?? 'stub';
  invalidateSchemaCache();
  await withoutTenant(pool, (tx) => applyProductSeed(tx, undefined, { providerName }));
  // The catalogue of plans and who is on which belong to the operator, so they are
  // written on the operator connection exactly as provisioning does it.
  await applyPackageSeed(db.operatorPool);
  await db.operatorPool.query(
    `INSERT INTO tenant_subscriptions (tenant_id, package_code)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET package_code = EXCLUDED.package_code,
                                           status = 'active'`,
    [tenantId, options.packageCode ?? 'ENTERPRISE'],
  );

  await withTenant(pool, tenantId, async (tx) => {
    await tx.query(
      `INSERT INTO tenant_provider_binding (tenant_id, provider, mode, credential_ref, activated_at)
       VALUES ($1, $3, 'BYOC', $2, now())
       ON CONFLICT (tenant_id, provider) DO NOTHING`,
      [tenantId, SECRET_REF, providerName],
    );

    await topUp(tx, {
      amount: options.balanceHalalas ?? 1_000_00,
      vatInvoiceId: 'INV-TEST-1',
    });

    const prices = options.prices ?? [
      { productCode: 'ADDRESS_ONLY', unitPriceHalalas: 8_00 },
      { productCode: 'KYB_COMPLETE', unitPriceHalalas: 44_00 },
      { productCode: 'IBAN_OWNERSHIP', unitPriceHalalas: 12_00 },
    ];

    for (const price of prices) {
      await openPriceVersion(tx, {
        productCode: price.productCode,
        unitPriceHalalas: price.unitPriceHalalas,
        ...(price.negativePct === undefined ? {} : { negativePct: price.negativePct }),
        ...(price.cachePct === undefined ? {} : { cachePct: price.cachePct }),
      });
    }
  });
}
