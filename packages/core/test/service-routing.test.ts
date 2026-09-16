import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { applyCostSeed } from '../../../packages/db/src/seed/costs.js';
import {
  listServiceRoutes,
  removeServiceRoute,
  serviceRouting,
  setServiceRoute,
  countProviderCall,
} from '../src/routing/service-routing.js';
import { resolveProviders } from '../src/routing/provider-routing.js';
import { listChecks } from '../src/customers/checks.js';
import { setTenantOverride } from '../src/billing/package-admin.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant } from '../../../test/helpers/billing.js';

/**
 * Choosing which provider serves a verification service, from the panel (ADR-135).
 *
 * The owner's question is not «can it be configured» but «how do I know the calls actually
 * moved». So what is proven here is the whole chain: the choice changes who the resolver names,
 * a provider carried on standby is not called, the cost and the margin follow the provider that
 * will serve rather than the one a product step declares, and every call is counted against the
 * provider that made it, which is what the panel shows back.
 */

const ALPHA = 'alpha-registry';
const BETA = 'beta-registry';

describe('which provider serves a service', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const operator = () => db.operatorPool;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Routing Tenant');
    await preparePricedTenant(db, tenant.tenantId, { balanceHalalas: 100_00 });
    await withoutTenant(db.appPool, (tx) => applyCostSeed(tx));

    // The helper binds every subscriber to the stub with their own credential. That is a BYOC
    // binding, and a BYOC binding is a subscriber's own account, which no platform choice may
    // move: see the last test in this block. What is being measured here is the ordinary case,
    // where we call with our credential, so the binding is put back to MANAGED.
    await db.operatorPool.query(
      `UPDATE tenant_provider_binding SET mode = 'MANAGED' WHERE tenant_id = $1`,
      [tenant.tenantId],
    );

    // Two providers in the catalogue, both able to serve the registry endpoints.
    for (const [code, name] of [
      [ALPHA, 'المزود الأول'],
      [BETA, 'المزود الثاني'],
    ]) {
      await operator().query(
        `INSERT INTO provider_catalog (code, name_ar, name_en, endpoints, status)
         VALUES ($1, $2, $1, ARRAY['corporate_full', 'national_address'], 'active')
         ON CONFLICT (code) DO NOTHING`,
        [code, name],
      );
      await operator().query(
        `INSERT INTO provider_connections (provider, environment, kind, base_url, credential_ref)
         VALUES ($1, 'live', 'http', 'https://example.sa', $2)
         ON CONFLICT (provider, environment) DO NOTHING`,
        [code, `kms://providers/${code}/live`],
      );
    }

    // Alpha is cheap on the registry, Beta is dear. The margin must follow whichever serves.
    await withoutTenant(db.appPool, async (tx) => {
      await tx.query(
        `INSERT INTO cost_book (provider, endpoint, unit_cost) VALUES
           ($1, 'corporate_full', 4.00),
           ($2, 'corporate_full', 9.00)
         ON CONFLICT DO NOTHING`,
        [ALPHA, BETA],
      );
    });
  });

  afterAll(async () => {
    await db.close();
  });

  const candidates = async (productCode: string, endpoint: string): Promise<string[]> =>
    (
      await withTenant(db.appPool, tenant.tenantId, (tx) =>
        resolveProviders(tx, { endpoint, productCode, declaredProvider: 'lean' }),
      )
    ).map((candidate) => candidate.provider);

  it('names the provider the panel put on the service, before the one the product declares', async () => {
    await setServiceRoute(operator(), {
      productCode: 'CR_FULL',
      provider: ALPHA,
      priority: 1,
      actorId: 'nx-staff:test',
    });

    const named = await candidates('CR_FULL', 'corporate_full');
    expect(named[0]).toBe(ALPHA);
    // The product's own declaration survives at the end, so a catalogue that names one keeps
    // working and an outage falls through to it.
    expect(named).toContain('lean');
  });

  it('puts a second provider next in line, so an outage needs no intervention', async () => {
    await setServiceRoute(operator(), {
      productCode: 'CR_FULL',
      provider: BETA,
      priority: 2,
      actorId: 'nx-staff:test',
    });
    // Alpha and Beta from the panel, then the subscriber's general binding, then the product's
    // own declaration. Four names, and the order is the decision.
    expect(await candidates('CR_FULL', 'corporate_full')).toEqual([ALPHA, BETA, 'stub', 'lean']);
  });

  it('does not call a provider carried on standby', async () => {
    await setServiceRoute(operator(), {
      productCode: 'CR_FULL',
      provider: BETA,
      priority: 2,
      status: 'standby',
      actorId: 'nx-staff:test',
    });
    const named = await candidates('CR_FULL', 'corporate_full');
    expect(named).not.toContain(BETA);
    expect(named[0]).toBe(ALPHA);
  });

  it('switches the service by moving the other provider to the front', async () => {
    await setServiceRoute(operator(), {
      productCode: 'CR_FULL',
      provider: BETA,
      priority: 1,
      status: 'active',
      actorId: 'nx-staff:test',
    });
    await setServiceRoute(operator(), {
      productCode: 'CR_FULL',
      provider: ALPHA,
      priority: 2,
      actorId: 'nx-staff:test',
    });
    expect((await candidates('CR_FULL', 'corporate_full'))[0]).toBe(BETA);
  });

  it('serves a service nothing is routed to from the general binding, as before', async () => {
    // Nothing routed, so the subscriber's own general binding answers, then the product's
    // declaration. This is what every deployment did before service routing existed.
    expect(await candidates('NATIONAL_ADDRESS', 'national_address')).toEqual(['stub', 'lean']);
  });

  it('never moves a subscriber who brought their own account', async () => {
    await db.operatorPool.query(
      `UPDATE tenant_provider_binding SET mode = 'BYOC' WHERE tenant_id = $1`,
      [tenant.tenantId],
    );
    // BYOC is their contract and their credential. A choice made for the platform does not
    // reach into it, and the panel's provider is offered only behind it.
    const named = await candidates('CR_FULL', 'corporate_full');
    expect(named[0]).toBe('stub');
    expect(named).toContain(BETA);
    await db.operatorPool.query(
      `UPDATE tenant_provider_binding SET mode = 'MANAGED' WHERE tenant_id = $1`,
      [tenant.tenantId],
    );
  });

  it('writes every change to the staff trail', async () => {
    const { rows } = await operator().query<{ action: string; target: string; metadata: unknown }>(
      `SELECT action, target, metadata FROM operator_audit
       WHERE target = 'routing:CR_FULL' ORDER BY at`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows[0]?.action).toBe('routing.set');
    // Which provider served a verification is what an auditor asks a year later.
    expect(JSON.stringify(rows[0]?.metadata)).toContain(ALPHA);
  });

  it('costs and prices the service under whoever will serve it', async () => {
    const rows = await serviceRouting(operator());
    const service = rows.find((row) => row.productCode === 'CR_FULL');
    expect(service?.servedBy).toBe(BETA);
    // Beta is the dear one, and the figure on the screen follows the switch.
    expect(service?.costHalalas).toBe(900);

    const alpha = service?.offers.find((offer) => offer.provider === ALPHA);
    expect(alpha?.costHalalas).toBe(400);
    expect(alpha?.serves).toBe(true);
  });

  it('says a provider does not serve a service rather than showing half a cost', async () => {
    const rows = await serviceRouting(operator());
    const address = rows.find((row) => row.productCode === 'NATIONAL_ADDRESS');
    const alpha = address?.offers.find((offer) => offer.provider === ALPHA);
    // Alpha has no price for the address endpoint, so its cost is unknown rather than zero.
    expect(alpha?.costHalalas).toBeNull();
    expect(alpha?.serves).toBe(false);
  });

  it('counts a call against the provider that made it, and shows it back', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await countProviderCall(tx, {
        provider: BETA,
        productCode: 'CR_FULL',
        endpoint: 'corporate_full',
        failed: false,
        costHalalas: 900,
      });
      await countProviderCall(tx, {
        provider: BETA,
        productCode: 'CR_FULL',
        endpoint: 'corporate_full',
        failed: true,
      });
    });

    const rows = await serviceRouting(operator());
    const served = rows.find((row) => row.productCode === 'CR_FULL')?.served ?? [];
    const beta = served.find((row) => row.provider === BETA);
    expect(beta?.calls).toBe(2);
    expect(beta?.failed).toBe(1);
    expect(served.some((row) => row.provider === ALPHA)).toBe(false);
  });

  it('never lets a counter break the verification it counts', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      // A provider name the check refuses. The counter swallows it inside its own savepoint.
      await countProviderCall(tx, {
        provider: '',
        productCode: 'CR_FULL',
        endpoint: 'corporate_full',
        failed: false,
      });
      // The transaction is still usable, which is the whole point.
      const { rows } = await tx.query<{ ok: number }>('SELECT 1 AS ok');
      expect(rows[0]?.ok).toBe(1);
    });
  });

  it('lists what is routed, and lets a provider be taken off', async () => {
    expect((await listServiceRoutes(operator(), 'CR_FULL')).map((route) => route.provider)).toEqual(
      [BETA, ALPHA],
    );
    await removeServiceRoute(operator(), {
      productCode: 'CR_FULL',
      provider: ALPHA,
      actorId: 'nx-staff:test',
    });
    expect(await listServiceRoutes(operator(), 'CR_FULL')).toHaveLength(1);
    await expect(
      removeServiceRoute(operator(), {
        productCode: 'CR_FULL',
        provider: ALPHA,
        actorId: 'nx-staff:test',
      }),
    ).rejects.toMatchObject({ code: 'NX-4041' });
  });
});

describe('turning a service off for one subscriber', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Switched Tenant');
    await preparePricedTenant(db, tenant.tenantId, { balanceHalalas: 100_00 });
  });

  afterAll(async () => {
    await db.close();
  });

  const offered = async (): Promise<string[]> =>
    (await withTenant(db.appPool, tenant.tenantId, (tx) => listChecks(tx))).map(
      (check) => check.productCode,
    );

  it('offers every section of the file while nothing is switched off', async () => {
    const codes = await offered();
    expect(codes).toContain('CR_FULL');
    expect(codes).toContain('NATIONAL_ADDRESS');
    // The property service has been in the catalogue since migration 0045 and had no place in
    // the file until 0050 gave it one.
    expect(codes).toContain('PROPERTY_VERIFICATION');
  });

  it('takes the section away from that subscriber alone', async () => {
    await setTenantOverride(
      db.operatorPool,
      { tenantId: tenant.tenantId, productCode: 'NATIONAL_ADDRESS', enabled: false },
      'nx-staff:test',
    );
    const codes = await offered();
    expect(codes).not.toContain('NATIONAL_ADDRESS');
    expect(codes).toContain('CR_FULL');
  });

  it('gives it back when the exception is lifted', async () => {
    await setTenantOverride(
      db.operatorPool,
      { tenantId: tenant.tenantId, productCode: 'NATIONAL_ADDRESS', enabled: null },
      'nx-staff:test',
    );
    expect(await offered()).toContain('NATIONAL_ADDRESS');
  });
});
