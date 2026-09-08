import type pg from 'pg';
import { withTenant, withoutTenant } from '../../packages/db/src/client.js';
import { applyProductSeed } from '../../packages/db/src/seed/products.js';
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
}

/** Seeds products, a provider binding, a funded wallet and a price list for a tenant. */
export async function preparePricedTenant(
  pool: pg.Pool,
  tenantId: string,
  options: PricedTenantOptions = {},
): Promise<void> {
  const providerName = options.providerName ?? 'stub';
  invalidateSchemaCache();
  await withoutTenant(pool, (tx) => applyProductSeed(tx, undefined, { providerName }));

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
