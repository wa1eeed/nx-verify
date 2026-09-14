import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { applyCostSeed } from '../../../packages/db/src/seed/costs.js';
import {
  authenticateOperator,
  createFirstOwner,
  createOperatorAccount,
  updateOperatorAccount,
  type OperatorIdentity,
} from '../src/operators/accounts.js';
import { listOperatorAudit } from '../src/operators/audit.js';
import {
  getPlatformSettings,
  layoutsOf,
  listSectionRequirements,
  setPlatformSettings,
  setSectionRequirement,
} from '../src/settings/platform.js';
import {
  addCreditBundle,
  addPlan,
  listCreditBundles,
  listPlans,
  listProductPricing,
  listSpecialPrices,
  setListPrice,
  setProductOnSale,
  setSpecialPrice,
  setTenantDiscount,
} from '../src/billing/pricing-admin.js';
import { bundleBalance, requestBundle } from '../src/billing/bundles.js';
import { confirmTopUp } from '../src/billing/topups.js';
import { getWallet } from '../src/billing/wallet.js';
import { resolvePrice } from '../src/billing/price-book.js';
import { quoteChecks } from '../src/customers/quote.js';
import { listChecks, runChecks, type RunChecksDependencies } from '../src/customers/checks.js';
import { getCustomerFile } from '../src/customers/customer-file.js';
import { createRequest, getRequest } from '../src/customers/requests.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';
import {
  SANDBOX_IBAN,
  SANDBOX_UNN,
} from '../../../packages/providers/src/stub/verification-sandbox.js';

/**
 * Handoff phase 7: the administration panel of screen 05, on real Postgres.
 *
 * Staff sign in as themselves and their role decides what they may change; every change names
 * them. Prices are versioned and never under cost, bundles pay for runs before the wallet and
 * give back an operation a failed run did not use, a discount reaches the charge, and the
 * verification settings reach the files and the runs they govern.
 */

describe('the administration panel', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let owner: OperatorIdentity;
  const keys = testKeys();
  const fixture = providerFixture('lean');
  const operator = () => db.operatorPool;

  const deps = (tenantId: string): RunChecksDependencies => ({
    inTenant: (work) => withTenant(db.appPool, tenantId, work),
    keys,
    runStepFor: (tx) => fixture.runnerFor(tx),
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Panel Tenant');
    await preparePricedTenant(db, tenant.tenantId, {
      balanceHalalas: 5_000_00,
      providerName: 'lean',
    });
    await withoutTenant(db.appPool, (tx) => applyCostSeed(tx));
  });

  afterAll(async () => {
    await db.close();
  });

  it('makes the first owner with the token once, and signs staff in by name', async () => {
    const first = await createFirstOwner(operator(), {
      email: 'Owner@NX.sa',
      displayName: 'وليد الغامدي',
      password: 'a long enough passphrase',
    });
    owner = { id: first.id, displayName: first.displayName, role: first.role };
    expect(first.role).toBe('OWNER');
    await expect(
      createFirstOwner(operator(), {
        email: 'second@nx.sa',
        displayName: 'مالك ثانٍ',
        password: 'another long passphrase',
      }),
    ).rejects.toMatchObject({ code: 'NX-4091' });

    const signedIn = await authenticateOperator(
      operator(),
      'owner@nx.sa',
      'a long enough passphrase',
    );
    expect(signedIn.id).toBe(first.id);
    await expect(
      authenticateOperator(operator(), 'owner@nx.sa', 'the wrong passphrase'),
    ).rejects.toMatchObject({ code: 'NX-4011' });
    await expect(
      authenticateOperator(operator(), 'nobody@nx.sa', 'a long enough passphrase'),
    ).rejects.toMatchObject({ code: 'NX-4011' });
  });

  it('locks an account after five failures in a row', async () => {
    const support = await createOperatorAccount(operator(), owner, {
      email: 'support@nx.sa',
      displayName: 'فريق الدعم',
      role: 'SUPPORT',
      password: 'support passphrase here',
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        authenticateOperator(operator(), 'support@nx.sa', 'wrong passphrase value'),
      ).rejects.toMatchObject({ code: 'NX-4011' });
    }
    await expect(
      authenticateOperator(operator(), 'support@nx.sa', 'support passphrase here'),
    ).rejects.toMatchObject({ code: 'NX-4029' });

    // A role that may not price cannot, whatever the screen shows.
    const actor = { id: support.id, displayName: support.displayName, role: support.role };
    await expect(setListPrice(operator(), actor, 'CR_FULL', 25_00)).rejects.toMatchObject({
      code: 'NX-4031',
    });
  });

  it('always keeps one active owner', async () => {
    await expect(
      updateOperatorAccount(operator(), owner, owner.id, { role: 'PRICING' }),
    ).rejects.toMatchObject({ code: 'NX-4091' });
    await expect(
      updateOperatorAccount(operator(), owner, owner.id, { status: 'DISABLED' }),
    ).rejects.toMatchObject({ code: 'NX-4091' });
  });

  it('versions a list price, refuses one under cost, and says when the margin is thin', async () => {
    const before = (await listProductPricing(operator())).find(
      (row) => row.productCode === 'CR_FULL',
    );
    expect(before?.costHalalas).toBe(10_00);
    expect(before?.priceHalalas).toBe(20_00);
    expect(before?.marginPct).toBe(50);

    await expect(setListPrice(operator(), owner, 'CR_FULL', 9_99)).rejects.toMatchObject({
      code: 'NX-4002',
    });
    const thin = await setListPrice(operator(), owner, 'CR_FULL', 12_00);
    expect(thin).toMatchObject({ priceHalalas: 12_00, marginPct: 17, thinMargin: true });
    const fair = await setListPrice(operator(), owner, 'CR_FULL', 24_00);
    expect(fair).toMatchObject({ marginPct: 58, thinMargin: false });

    // The old rows are closed, never edited, and a subscriber is priced by the new one.
    const { rows } = await db.migratorPool.query<{ open: string; closed: string }>(
      `SELECT count(*) FILTER (WHERE valid_to IS NULL)::text AS open,
              count(*) FILTER (WHERE valid_to IS NOT NULL)::text AS closed
       FROM price_book WHERE product_code = 'CR_FULL' AND tenant_id IS NULL`,
    );
    expect(rows[0]).toEqual({ open: '1', closed: '2' });
    const charged = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      resolvePrice(tx, 'CR_FULL'),
    );
    expect(charged.unitPrice).toBe(24_00);

    const audit = await listOperatorAudit(operator(), {
      targetPrefixes: ['pricing:product:CR_FULL'],
    });
    expect(audit[0]).toMatchObject({ operatorName: 'وليد الغامدي', action: 'pricing.list_price' });
  });

  it('takes a check off sale and puts it back', async () => {
    await setProductOnSale(operator(), owner, 'NATIONAL_ADDRESS', false);
    const offered = await withTenant(db.appPool, tenant.tenantId, (tx) => listChecks(tx));
    expect(offered.map((check) => check.productCode)).not.toContain('NATIONAL_ADDRESS');
    await setProductOnSale(operator(), owner, 'NATIONAL_ADDRESS', true);
    const back = await withTenant(db.appPool, tenant.tenantId, (tx) => listChecks(tx));
    expect(back.map((check) => check.productCode)).toContain('NATIONAL_ADDRESS');
  });

  it('prices bundles to cover the dearest call, and says what each saves', async () => {
    const bundles = await listCreditBundles(operator());
    expect(bundles.map((bundle) => [bundle.operations, bundle.discountPct])).toEqual([
      [500, null],
      [2000, 8],
      [10000, 15],
    ]);
    await expect(
      addCreditBundle(operator(), owner, { operations: 1000, priceHalalas: 5_000_00 }),
    ).rejects.toMatchObject({ code: 'NX-4002' });
    const added = await addCreditBundle(operator(), owner, {
      operations: 1000,
      priceHalalas: 19_000_00,
    });
    expect(added).toMatchObject({ code: 'BUNDLE_1000', perOperationHalalas: 19_00 });
  });

  it('pays a run from a bundle before the wallet, and gives back what a failed run did not use', async () => {
    const request = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      requestBundle(tx, { bundleCode: 'BUNDLE_500' }),
    );
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      confirmTopUp(tx, {
        requestId: request.id,
        vatInvoiceId: 'INV-BUNDLE-1',
        settledBy: owner.id,
      }),
    );
    // Confirming again grants nothing more.
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        confirmTopUp(tx, {
          requestId: request.id,
          vatInvoiceId: 'INV-BUNDLE-1',
          settledBy: owner.id,
        }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4091' });
    expect(
      (await withTenant(db.appPool, tenant.tenantId, (tx) => bundleBalance(tx))).operations,
    ).toBe(500);

    const wallet = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    await runChecks(deps(tenant.tenantId), {
      kind: 'BUSINESS',
      identity: { unn: SANDBOX_UNN.ACTIVE },
      productCodes: ['CR_FULL'],
      bundleKey: randomUUID(),
      requestedBy: null,
    });
    await runChecks(deps(tenant.tenantId), {
      kind: 'BUSINESS',
      identity: { unn: SANDBOX_UNN.SOURCE_DOWN },
      productCodes: ['CR_FULL'],
      bundleKey: randomUUID(),
      requestedBy: null,
    });

    expect(
      (await withTenant(db.appPool, tenant.tenantId, (tx) => bundleBalance(tx))).operations,
    ).toBe(499);
    const after = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    expect(after.balance).toBe(wallet.balance);
    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ status: string; charge_source: string }>(
        `SELECT status, charge_source FROM verification_runs
         WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 2`,
        [tx.tenantId],
      ),
    );
    expect(rows.map((row) => [row.status, row.charge_source]).sort()).toEqual([
      ['ERROR', 'BUNDLE'],
      ['OK', 'BUNDLE'],
    ]);
  });

  it('adds a monthly plan with every check on sale in it', async () => {
    await expect(
      addPlan(operator(), owner, {
        code: 'START',
        nameAr: 'البداية',
        nameEn: 'Start',
        monthlyFeeHalalas: 990_00,
        includedTransactions: 300,
        overageUnitHalalas: 3_20,
      }),
    ).rejects.toMatchObject({ code: 'NX-4002' });
    const plan = await addPlan(operator(), owner, {
      code: 'START',
      nameAr: 'البداية',
      nameEn: 'Start',
      monthlyFeeHalalas: 990_00,
      includedTransactions: 300,
      overageUnitHalalas: 16_00,
    });
    expect(plan).toMatchObject({
      monthlyFeeHalalas: 990_00,
      includedTransactions: 300,
      negotiated: false,
    });
    expect((await listPlans(operator())).map((entry) => entry.code)).toContain('START');
  });

  it('keeps special prices and discounts above cost, and charges them', async () => {
    await expect(
      setSpecialPrice(operator(), owner, {
        tenantId: tenant.tenantId,
        productCode: 'CR_FULL',
        priceHalalas: 8_00,
      }),
    ).rejects.toMatchObject({ code: 'NX-4002' });
    await setSpecialPrice(operator(), owner, {
      tenantId: tenant.tenantId,
      productCode: 'IBAN_VERIFICATION',
      priceHalalas: 11_00,
    });
    await expect(
      setTenantDiscount(operator(), owner, { tenantId: tenant.tenantId, discountPct: 80 }),
    ).rejects.toMatchObject({ code: 'NX-4002' });
    await setTenantDiscount(operator(), owner, { tenantId: tenant.tenantId, discountPct: 25 });

    const special = await listSpecialPrices(operator());
    expect(special.find((entry) => entry.tenantId === tenant.tenantId)).toMatchObject({
      discountPct: 25,
      products: [{ productCode: 'IBAN_VERIFICATION', priceHalalas: 11_00 }],
    });

    const quote = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      quoteChecks(tx, ['CR_FULL', 'IBAN_VERIFICATION']),
    );
    const price = (code: string) =>
      quote.lines.find((line) => line.productCode === code)?.unitPriceHalalas;
    // 24.00 less a quarter, and the product's own price untouched by the discount.
    expect(price('CR_FULL')).toBe(18_00);
    expect(price('IBAN_VERIFICATION')).toBe(11_00);
  });

  it('applies the verification settings to the attempts, the sections and the name match', async () => {
    await expect(
      setPlatformSettings(operator(), owner, {
        maxAttempts: 9,
        resultValidityDays: 90,
        nameMatchThresholdPct: 85,
        registryAlertDays: 30,
      }),
    ).rejects.toMatchObject({ code: 'NX-4002' });
    const settings = await setPlatformSettings(operator(), owner, {
      maxAttempts: 3,
      resultValidityDays: 90,
      nameMatchThresholdPct: 50,
      registryAlertDays: 30,
    });
    expect(settings.maxAttempts).toBe(3);

    const created = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      createRequest(tx, keys, {
        kind: 'COMPANY',
        subject: { number: SANDBOX_UNN.ACTIVE },
        productCodes: ['CR_FULL'],
        bundleKey: randomUUID(),
        requestedBy: null,
      }),
    );
    const view = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getRequest(tx, keys, created.requestId),
    );
    expect(view?.checks[0]?.maxAttempts).toBe(3);

    await expect(
      setSectionRequirement(operator(), owner, {
        kind: 'COMPANY',
        section: 'REGISTRY',
        requirement: 'OPTIONAL',
      }),
    ).rejects.toMatchObject({ code: 'NX-4002' });
    await setSectionRequirement(operator(), owner, {
      kind: 'ESTABLISHMENT',
      section: 'MANAGERS',
      requirement: 'REQUIRED',
    });
    const layouts = layoutsOf(await listSectionRequirements(operator()));
    expect(layouts.ESTABLISHMENT.find(([section]) => section === 'MANAGERS')?.[1]).toBe('REQUIRED');

    // An account whose holder's name matches partly: at a threshold of 50 it counts as theirs.
    const result = await runChecks(deps(tenant.tenantId), {
      kind: 'BUSINESS',
      identity: { unn: SANDBOX_UNN.SUSPENDED },
      productCodes: ['IBAN_VERIFICATION'],
      inputs: { iban: SANDBOX_IBAN.OTHER_NAME },
      bundleKey: randomUUID(),
      requestedBy: null,
    });
    const file = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getCustomerFile(tx, keys, result.entityId ?? ''),
    );
    expect(file?.nameMatchThresholdPct).toBe(50);
    const banking = file?.sections.find((section) => section.section === 'BANKING');
    expect(banking?.fields.length).toBeGreaterThan(0);
    expect(banking?.state).not.toBe('CONFLICT');
    expect(file?.assessment.items.find((item) => item.key === 'bank_account')?.state).toBe('PASS');

    const audit = await listOperatorAudit(operator(), { targetPrefixes: ['settings:'] });
    expect(audit.map((entry) => entry.action)).toEqual(['settings.section', 'settings.updated']);
    expect(await getPlatformSettings(db.appPool)).toMatchObject({ nameMatchThresholdPct: 50 });
  });
});
