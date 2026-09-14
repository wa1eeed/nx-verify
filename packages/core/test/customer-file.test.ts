import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { runChecks, type RunChecksDependencies } from '../src/customers/checks.js';
import { getCustomerFile } from '../src/customers/customer-file.js';
import { countCustomers, listCustomers } from '../src/customers/list.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';
import {
  SANDBOX_FREELANCER,
  SANDBOX_IBAN,
  SANDBOX_UNN,
} from '../../../packages/providers/src/stub/verification-sandbox.js';

/**
 * Unit 78 acceptance: the customer file the owner described, on real data.
 *
 * A full verification is ticked and run the way the console runs it, and the file that
 * comes back is read the way the console reads it: by section, with a classification, with
 * the indicators and the reason for each, and with the links to this subscriber's other
 * customers that the facts reveal. And never to another subscriber's.
 */

const ALL_BUSINESS_CHECKS = [
  'CR_FULL',
  'ARTICLES_OF_ASSOCIATION',
  'MANAGER_AUTHORITY',
  'NATIONAL_ADDRESS',
  'IBAN_VERIFICATION',
];

describe('the customer file', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let other: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  const depsFor = (tenantId: string): RunChecksDependencies => ({
    inTenant: (work) => withTenant(db.appPool, tenantId, work),
    keys,
    runStepFor: (tx) => fixture.runnerFor(tx),
  });

  const fileOf = (tenantId: string, entityId: string) =>
    withTenant(db.appPool, tenantId, (tx) =>
      getCustomerFile(tx, keys, entityId, { now: new Date('2026-09-14T09:00:00Z') }),
    );

  let companyId = '';
  let firstBundle = '';

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'File Tenant');
    other = await seedTenant(db.appPool, 'Another Subscriber');
    await preparePricedTenant(db, tenant.tenantId, { balanceHalalas: 50_000_00 });
    await preparePricedTenant(db, other.tenantId, { balanceHalalas: 50_000_00 });
  });

  afterAll(async () => {
    await db.close();
  });

  it('runs every ticked check once, in order, and reports each', async () => {
    firstBundle = randomUUID();
    const result = await runChecks(depsFor(tenant.tenantId), {
      kind: 'BUSINESS',
      identity: { unn: SANDBOX_UNN.ACTIVE },
      productCodes: ALL_BUSINESS_CHECKS,
      inputs: { iban: SANDBOX_IBAN.MATCH },
      bundleKey: firstBundle,
      requestedBy: null,
    });
    companyId = result.entityId ?? '';
    expect(companyId).not.toBe('');

    const byCode = (code: string) =>
      result.outcomes.filter((outcome) => outcome.productCode === code);
    expect(byCode('CR_FULL')[0]?.status).toBe('OK');
    expect(byCode('ARTICLES_OF_ASSOCIATION')[0]?.status).toBe('OK');
    expect(byCode('NATIONAL_ADDRESS')[0]?.status).toBe('OK');
    expect(byCode('IBAN_VERIFICATION')[0]?.status).toBe('OK');
    // One call per manager the registry and the articles named.
    expect(byCode('MANAGER_AUTHORITY').length).toBeGreaterThanOrEqual(1);
    expect(byCode('MANAGER_AUTHORITY').some((outcome) => outcome.status === 'OK')).toBe(true);
  });

  it('is the same verification, and the same charges, when the form is sent twice', async () => {
    const count = () =>
      withTenant(db.appPool, tenant.tenantId, async (tx) => {
        const { rows } = await tx.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM verification_runs WHERE tenant_id = $1`,
          [tx.tenantId],
        );
        return Number(rows[0]?.count ?? 0);
      });
    const before = await count();
    await runChecks(depsFor(tenant.tenantId), {
      entityId: companyId,
      kind: 'BUSINESS',
      identity: {},
      productCodes: ALL_BUSINESS_CHECKS,
      inputs: { iban: SANDBOX_IBAN.MATCH },
      bundleKey: firstBundle,
      requestedBy: null,
    });
    expect(await count()).toBe(before);
  });

  it('reads as sections, with a classification from the registry', async () => {
    const file = await fileOf(tenant.tenantId, companyId);
    expect(file?.kind).toBe('COMPANY');
    expect(file?.kindLabelAr).toBe('شركة');
    expect(file?.status).toEqual({ textAr: 'فعال', tone: 'fresh' });

    const sections = new Map(file?.sections.map((section) => [section.section, section]));
    expect(sections.get('REGISTRY')?.state).toBe('VERIFIED');
    expect(sections.get('REGISTRY')?.fields.map((field) => field.fieldPath)).toContain(
      'cr.core.name',
    );
    expect(sections.get('CONTRACT')?.state).toBe('VERIFIED');
    expect(sections.get('ADDRESS')?.fields.every((field) => field.authority !== null)).toBe(true);
    expect(
      sections.get('BANKING')?.fields.find((field) => field.fieldPath === 'bank.iban_ownership')
        ?.valueLabelAr,
    ).toBe('مطابق');
    // Hidden facts are used, never listed.
    expect(sections.get('REGISTRY')?.fields.map((field) => field.fieldPath)).not.toContain(
      'cr.status_code',
    );
  });

  it('lists the managers with their masked ID, positions and powers in this company', async () => {
    const file = await fileOf(tenant.tenantId, companyId);
    expect(file?.managers.length).toBeGreaterThan(0);
    const checked = file?.managers.find((manager) => manager.permissions !== null);
    expect(checked?.permissions?.length).toBeGreaterThan(0);
    expect(checked?.maskedId).toMatch(/•/);
    expect(JSON.stringify(file)).not.toContain('1234567890');
  });

  it('explains its KYB indicators and rates a clean, checked company as low risk', async () => {
    const file = await fileOf(tenant.tenantId, companyId);
    const items = new Map(file?.assessment.items.map((item) => [item.key, item]));
    expect(file?.assessment.mode).toBe('KYB');
    expect(items.get('registry_active')?.state).toBe('PASS');
    expect(items.get('articles')?.state).toBe('PASS');
    expect(items.get('national_address')?.state).toBe('PASS');
    expect(items.get('bank_account')?.state).toBe('PASS');
    expect(file?.assessment.signals.map((signal) => signal.key)).toEqual([]);
    expect(file?.assessment.riskLevel).toBe('LOW');
  });

  it('skips the articles of a sole establishment without calling or charging', async () => {
    const result = await runChecks(depsFor(tenant.tenantId), {
      kind: 'BUSINESS',
      identity: { unn: SANDBOX_UNN.ESTABLISHMENT },
      productCodes: ['CR_FULL', 'ARTICLES_OF_ASSOCIATION', 'NATIONAL_ADDRESS'],
      bundleKey: randomUUID(),
      requestedBy: null,
    });
    const articles = result.outcomes.find(
      (outcome) => outcome.productCode === 'ARTICLES_OF_ASSOCIATION',
    );
    expect(articles?.status).toBe('SKIPPED');
    expect(articles?.noteAr).toContain('المؤسسة الفردية');

    const file = await fileOf(tenant.tenantId, result.entityId ?? '');
    expect(file?.kindLabelAr).toBe('مؤسسة');
    expect(file?.assessment.items.find((item) => item.key === 'articles')?.state).toBe('NA');
    // The same national address as the active company, which the file now says.
    expect(file?.intersections.map((intersection) => intersection.kind)).toContain(
      'SHARED_ADDRESS',
    );
  });

  it('shows a shared manager and a shared IBAN on both files, and rates the second high risk', async () => {
    const result = await runChecks(depsFor(tenant.tenantId), {
      kind: 'BUSINESS',
      identity: { unn: SANDBOX_UNN.SUSPENDED },
      productCodes: ['CR_FULL', 'IBAN_VERIFICATION'],
      inputs: { iban: SANDBOX_IBAN.MATCH },
      bundleKey: randomUUID(),
      requestedBy: null,
    });
    const suspended = await fileOf(tenant.tenantId, result.entityId ?? '');
    const kinds = suspended?.intersections.map((intersection) => intersection.kind) ?? [];
    expect(kinds).toContain('SHARED_MANAGER');
    expect(kinds).toContain('SHARED_ACCOUNT');
    expect(suspended?.assessment.riskLevel).toBe('HIGH');
    expect(suspended?.assessment.signals.map((signal) => signal.key)).toEqual(
      expect.arrayContaining(['registry_inactive', 'shared_account']),
    );

    const first = await fileOf(tenant.tenantId, companyId);
    const shared = first?.intersections.find(
      (intersection) => intersection.kind === 'SHARED_MANAGER',
    );
    expect(shared?.entities.map((entity) => entity.entityId)).toContain(result.entityId);
  });

  it("never links to another subscriber's customers, whatever they verified", async () => {
    const theirs = await runChecks(depsFor(other.tenantId), {
      kind: 'BUSINESS',
      identity: { unn: SANDBOX_UNN.ACTIVE },
      productCodes: ['CR_FULL', 'NATIONAL_ADDRESS', 'IBAN_VERIFICATION'],
      inputs: { iban: SANDBOX_IBAN.MATCH },
      bundleKey: randomUUID(),
      requestedBy: null,
    });
    const theirFile = await fileOf(other.tenantId, theirs.entityId ?? '');
    expect(theirFile?.intersections).toEqual([]);
    // And the first subscriber cannot open the other's customer at all.
    expect(await fileOf(tenant.tenantId, theirs.entityId ?? '')).toBeNull();
  });

  it('reads a freelancer as KYC, from the certificate', async () => {
    const result = await runChecks(depsFor(tenant.tenantId), {
      kind: 'FREELANCER',
      identity: {
        nationalId: SANDBOX_FREELANCER.NATIONAL_ID,
        certificateNumber: SANDBOX_FREELANCER.ACTIVE,
      },
      productCodes: ['FREELANCE_CERTIFICATE', 'CR_FULL'],
      bundleKey: randomUUID(),
      requestedBy: null,
    });
    expect(
      result.outcomes.find((outcome) => outcome.productCode === 'FREELANCE_CERTIFICATE')?.status,
    ).toBe('OK');

    const file = await fileOf(tenant.tenantId, result.entityId ?? '');
    expect(file?.kind).toBe('FREELANCER');
    expect(file?.kindLabelAr).toBe('عامل حر');
    expect(file?.assessment.mode).toBe('KYC');
    expect(file?.assessment.items.find((item) => item.key === 'certificate_active')?.state).toBe(
      'PASS',
    );
    expect(file?.sections.map((section) => section.section)).toContain('FREELANCE');
    expect(file?.status.tone).toBe('fresh');
  });

  it('lists customers, not the people and accounts inside their files', async () => {
    const rows = await withTenant(db.appPool, tenant.tenantId, (tx) => listCustomers(tx, keys));
    expect(
      rows.every((row) => row.entityType === 'BUSINESS' || row.entityType === 'FREELANCER'),
    ).toBe(true);
    const company = rows.find((row) => row.entityId === companyId);
    expect(company?.kind).toBe('COMPANY');
    expect(company?.statusText).toBe('فعال');
    expect(company?.statusTone).toBe('fresh');

    const counts = await withTenant(db.appPool, tenant.tenantId, (tx) => countCustomers(tx));
    expect(counts.companies).toBeGreaterThanOrEqual(2);
    expect(counts.establishments).toBe(1);
    expect(counts.freelancers).toBe(1);
  });

  it('finds a customer by number through its keyed hash, and by part of its name', async () => {
    const byNumber = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listCustomers(tx, keys, { search: SANDBOX_UNN.ACTIVE }),
    );
    expect(byNumber.map((row) => row.entityId)).toEqual([companyId]);

    const byName = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listCustomers(tx, keys, { search: 'موقوفة' }),
    );
    expect(byName).toHaveLength(1);

    const establishments = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listCustomers(tx, keys, { kind: 'ESTABLISHMENT' }),
    );
    expect(establishments.map((row) => row.kind)).toEqual(['ESTABLISHMENT']);
  });
});
