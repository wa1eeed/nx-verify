import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { listModules, setTenantModule, tenantModules } from '../src/modules/modules.js';
import { listChecks, runChecks, type RunChecksDependencies } from '../src/customers/checks.js';
import { getCustomerFile } from '../src/customers/customer-file.js';
import { resolveEntitlement } from '../src/billing/entitlements.js';
import { setTenantOverride } from '../src/billing/package-admin.js';
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
 * Modules: the unit a subscriber is sold, and the unit a customer file is drawn from (ADR-137).
 *
 * The question behind this whole file is the owner's: «if I switch a service off for one
 * subscriber, what exactly disappears». The answer has to be the same in three places at once,
 * and each is checked here: the section leaves their customer files, the check leaves their
 * request screen, and the API refuses it. A screen that hides a service whose endpoint keeps
 * answering is not a switch, it is a decoration.
 *
 * And the arithmetic, which is the part that was wrong before this existed: a section they were
 * never sold must not be counted as a section they are missing.
 */

describe('modules', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let companyId = '';
  const keys = testKeys();
  const fixture = providerFixture();
  const staff = 'nx-staff:test';

  const deps = (): RunChecksDependencies => ({
    inTenant: (work) => withTenant(db.appPool, tenant.tenantId, work),
    keys,
    runStepFor: (tx) => fixture.runnerFor(tx),
  });

  const offered = async (): Promise<string[]> =>
    (await withTenant(db.appPool, tenant.tenantId, (tx) => listChecks(tx))).map(
      (check) => check.productCode,
    );

  const file = () =>
    withTenant(db.appPool, tenant.tenantId, (tx) =>
      getCustomerFile(tx, keys, companyId, { now: new Date('2026-09-16T09:00:00Z') }),
    );

  const entitlementFor = (productCode: string) =>
    withTenant(db.appPool, tenant.tenantId, (tx) => resolveEntitlement(tx, productCode));

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Modules Tenant');
    await preparePricedTenant(db, tenant.tenantId, { balanceHalalas: 500_00 });

    // A real company file, verified the way the console verifies one, so the sections and the
    // completeness figure below are the ones a subscriber would actually see.
    const result = await runChecks(deps(), {
      kind: 'BUSINESS',
      identity: { unn: SANDBOX_UNN.ACTIVE },
      inputs: { iban: SANDBOX_IBAN.MATCH },
      // Everything except the bank check, so the banking section is required and unfilled:
      // which is the subscriber who never bought that module, and the file that used to be
      // capped short of complete for ever because of it.
      productCodes: ['CR_FULL', 'ARTICLES_OF_ASSOCIATION', 'MANAGER_AUTHORITY', 'NATIONAL_ADDRESS'],
      bundleKey: randomUUID(),
      requestedBy: null,
    });
    companyId = result.entityId ?? '';
    expect(companyId).not.toBe('');
  });

  afterAll(async () => {
    await db.close();
  });

  it('lists every module with the products it sells, on both sides of the platform', async () => {
    const modules = await listModules(db.operatorPool);
    expect(modules.map((module) => module.code)).toEqual([
      'REGISTRY',
      'CONTRACT',
      'MANAGERS',
      'ADDRESS',
      'BANKING',
      'FREELANCE',
      'PROPERTY',
      'INCOME',
    ]);

    // A module carries the file check and the API product that ask the same question, so one
    // switch cannot leave a screen while an endpoint keeps answering.
    const property = modules.find((module) => module.code === 'PROPERTY');
    expect(property?.products.map((product) => product.productCode).sort()).toEqual([
      'PROPERTY_DEED',
      'PROPERTY_VERIFICATION',
    ]);
    expect(property?.products.find((p) => p.productCode === 'PROPERTY_DEED')?.inFile).toBe(false);
    expect(property?.defaultOn).toBe(false);

    expect(modules.find((module) => module.code === 'REGISTRY')?.core).toBe(true);
    expect(modules.find((module) => module.code === 'INCOME')?.section).toBe('INCOME');
  });

  it('offers a new subscriber the modules their plan sells, and no add on nobody asked for', async () => {
    const codes = await offered();
    expect(codes).toContain('CR_FULL');
    expect(codes).toContain('NATIONAL_ADDRESS');
    expect(codes).toContain('IBAN_VERIFICATION');
    // Property and income are add ons. The plan names a price for each and includes neither,
    // so a subscriber gets them when somebody decides to give them, not by default.
    expect(codes).not.toContain('PROPERTY_VERIFICATION');
    expect(codes).not.toContain('INCOME_VERIFICATION');
  });

  it('says why each module is on for a subscriber: core, their switch, their plan, the default', async () => {
    const view = await tenantModules(db.operatorPool, tenant.tenantId);
    const of = (code: string) => view.find((module) => module.code === code);

    expect(of('REGISTRY')).toMatchObject({ enabled: true, source: 'core' });
    expect(of('BANKING')).toMatchObject({ enabled: true, source: 'plan' });
    // Nothing decided and nothing in the plan, so the module's own default answers, and says
    // no. Inherited rather than copied: nobody has written a row for this subscriber.
    expect(of('INCOME')).toMatchObject({ enabled: false, source: 'default', decided: null });
  });

  it('takes the whole section out of every customer file when a module is switched off', async () => {
    const before = await file();
    const banking = before?.sections.find((section) => section.section === 'BANKING');
    expect(banking?.requirement).toBe('REQUIRED');
    // Required, unfilled, and unfillable: they never bought it.
    expect(banking?.done).toBe(false);
    // Three of five required sections done, and the two that are not are not the same kind of
    // thing: the managers section is genuinely half read, and the banking section is a service
    // they were never sold. Only one of those is the file's fault.
    expect(before?.completeness).toBe(60);
    const requiredBefore = before?.sectionsRequired ?? 0;
    const doneBefore = before?.sectionsDone ?? 0;

    // And income, which is a person's question rather than a company's, is not drawn on a
    // company file at all: not as a section, not as «not applicable». Nobody opens a company
    // file looking for a salary.
    expect(before?.sections.map((section) => section.section)).not.toContain('INCOME');

    await setTenantModule(
      db.operatorPool,
      { tenantId: tenant.tenantId, moduleCode: 'BANKING', enabled: false, note: 'لم يشترِها' },
      staff,
    );

    const after = await file();
    // Gone from the file, not greyed out in it.
    expect(after?.sections.map((section) => section.section)).not.toContain('BANKING');
    // And this is the arithmetic that was wrong: a section they were never sold is not a
    // section they are missing. One fewer required, none undone, and the file is complete.
    expect(after?.sectionsRequired).toBe(requiredBefore - 1);
    expect(after?.sectionsDone).toBe(doneBefore);
    // Three of four now. The manager gap is still counted, because that one is real.
    expect(after?.completeness).toBe(75);

    // Gone from the request screen too.
    expect(await offered()).not.toContain('IBAN_VERIFICATION');
  });

  it('refuses the run as well, so a screen and an endpoint never disagree', async () => {
    const entitlement = await entitlementFor('IBAN_VERIFICATION');
    expect(entitlement.allowed).toBe(false);
    expect(entitlement.refusal).toBe('MODULE_OFF');
    // The API product of the same module falls with it, which is the whole point of selling
    // by module rather than by product code.
    expect((await entitlementFor('IBAN_OWNERSHIP')).refusal).toBe('MODULE_OFF');
  });

  it('gives it back when the decision is lifted, and the plan answers again', async () => {
    await setTenantModule(
      db.operatorPool,
      { tenantId: tenant.tenantId, moduleCode: 'BANKING', enabled: null },
      staff,
    );
    expect(await offered()).toContain('IBAN_VERIFICATION');
    expect((await entitlementFor('IBAN_VERIFICATION')).allowed).toBe(true);

    const view = await tenantModules(db.operatorPool, tenant.tenantId);
    expect(view.find((module) => module.code === 'BANKING')).toMatchObject({
      source: 'plan',
      decided: null,
    });
  });

  it('switches an add on module on for one subscriber, though no plan includes it', async () => {
    await setTenantModule(
      db.operatorPool,
      { tenantId: tenant.tenantId, moduleCode: 'INCOME', enabled: true },
      staff,
    );
    expect(await offered()).toContain('INCOME_VERIFICATION');
    expect((await entitlementFor('INCOME_VERIFICATION')).allowed).toBe(true);
    // Switched on for them alone is a line written for them, and the panel counts it as one.
    expect((await entitlementFor('INCOME_VERIFICATION')).negotiated).toBe(true);
  });

  it('puts income in the file of an establishment and a freelancer, and not of a company', async () => {
    const checks = await withTenant(db.appPool, tenant.tenantId, (tx) => listChecks(tx));
    const income = checks.find((check) => check.productCode === 'INCOME_VERIFICATION');
    expect(income?.section).toBe('INCOME');
    expect(income?.appliesTo.sort()).toEqual(['ESTABLISHMENT', 'FREELANCER']);
    // A company's income is revenue, which is a different question with a different authority.
    expect(income?.appliesTo).not.toContain('COMPANY');
    // And it cannot be run until the customer's own consent can be asked for.
    expect(income?.availability).toBe('COMING_SOON');
  });

  it('lets an exception for one product beat the module it belongs to', async () => {
    await setTenantOverride(
      db.operatorPool,
      { tenantId: tenant.tenantId, productCode: 'INCOME_VERIFICATION', enabled: false },
      staff,
    );
    expect(await offered()).not.toContain('INCOME_VERIFICATION');
    await setTenantOverride(
      db.operatorPool,
      { tenantId: tenant.tenantId, productCode: 'INCOME_VERIFICATION', enabled: null },
      staff,
    );
    expect(await offered()).toContain('INCOME_VERIFICATION');
  });

  it('refuses to switch off the module every customer file is drawn from', async () => {
    await expect(
      setTenantModule(
        db.operatorPool,
        { tenantId: tenant.tenantId, moduleCode: 'REGISTRY', enabled: false },
        staff,
      ),
    ).rejects.toMatchObject({ code: 'NX-4003' });
    expect(await offered()).toContain('CR_FULL');
  });

  it('writes every decision to the subscriber trail, with who made it', async () => {
    // Read as the subscriber reads it: the trail is theirs, and staff write into it.
    const rows = await withTenant(
      db.appPool,
      tenant.tenantId,
      async (tx) =>
        (
          await tx.query<{
            action: string;
            target: string;
            actor_id: string;
            metadata: { enabled: boolean | null };
          }>(
            `SELECT action, target, actor_id, metadata FROM audit_log
            WHERE tenant_id = $1 AND action = 'module.set' ORDER BY created_at`,
            [tx.tenantId],
          )
        ).rows,
    );
    expect(rows.map((row) => row.target)).toEqual([
      'module:BANKING',
      'module:BANKING',
      'module:INCOME',
    ]);
    expect(rows[0]?.metadata.enabled).toBe(false);
    expect(rows[0]?.actor_id).toBe(staff);
  });

  it('counts by hand decisions per module, so the panel can see the plans drifting', async () => {
    const modules = await listModules(db.operatorPool);
    expect(modules.find((module) => module.code === 'INCOME')?.switchedOn).toBe(1);
    expect(modules.find((module) => module.code === 'BANKING')?.switchedOn).toBe(0);
  });
});
