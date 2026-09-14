import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../src/verification/verify.js';
import { getEntityProfile } from '../src/repositories/profile.js';
import { getRelations } from '../src/normalisation/network.js';
import { listIdentifiers } from '../src/repositories/identifiers.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';
import { scanForPlaintext } from '../../../test/helpers/plaintext-scan.js';
import {
  SANDBOX_FREELANCER,
  SANDBOX_IBAN,
  SANDBOX_MANAGER_ID,
  SANDBOX_UNN,
} from '../../../packages/providers/src/stub/verification-sandbox.js';

/**
 * Unit 77 acceptance: the checks of a customer file, run for real, fill the file.
 *
 * Each check runs through the whole path a subscriber's click takes: entitlement, price,
 * the provider answer in the data source's own shape, normalisation into attestations,
 * entities and links, and the charge. The assertions are about what a customer file will
 * then be able to show, and about what it must never store.
 */

describe('customer file checks', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  const keys = testKeys();
  const fixture = providerFixture();

  const run = (
    productCode: string,
    subject: Record<string, unknown>,
    identifiers: { idType: string; value: string }[],
  ) =>
    withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode,
        subject,
        subjectIdentifiers: identifiers as never,
        idempotencyKey: randomUUID(),
        triggeredBy: 'CONSOLE',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

  let companyId = '';
  let suspendedId = '';

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Checks Tenant');
    await preparePricedTenant(db, tenant.tenantId, { balanceHalalas: 10_000_00 });
  });

  afterAll(async () => {
    await db.close();
  });

  it('fills the basic section from the registry, with the classification and the name', async () => {
    const result = await run('CR_FULL', { unn: SANDBOX_UNN.ACTIVE }, [
      { idType: 'UNN', value: SANDBOX_UNN.ACTIVE },
    ]);
    expect(result.status).toBe('OK');
    companyId = result.entityId ?? '';

    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, companyId),
    );
    const value = (path: string) => profile.find((field) => field.fieldPath === path)?.value;
    expect(value('cr.core.name')).toBe('شركة اختبار للتجارة');
    expect(value('cr.kind')).toBe('COMPANY');
    expect(value('cr.status')).toBe('فعال');
    expect(profile.find((field) => field.fieldPath === 'cr.status')?.authority).toBe(
      'وزارة التجارة',
    );

    // The list shows the name the registry gave, kept current by the answer that gave it.
    const { rows } = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ display_name: string }>(
        `SELECT display_name FROM entities WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, companyId],
      ),
    );
    expect(rows[0]?.display_name).toBe('شركة اختبار للتجارة');
  });

  it('attaches the registration number as an identifier, never as a value', async () => {
    const identifiers = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      listIdentifiers(tx, keys, companyId),
    );
    expect(identifiers.map((identifier) => identifier.idType).sort()).toEqual(['CR', 'UNN']);
    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, companyId),
    );
    expect(JSON.stringify(profile)).not.toContain('1010711252');
  });

  it('makes each manager a person linked to the company, with positions held there', async () => {
    const relations = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getRelations(tx, companyId),
    );
    const manages = relations.filter((relation) => relation.relType === 'MANAGES');
    expect(manages.length).toBeGreaterThan(0);

    const personId = manages[0]?.toEntity ?? '';
    const person = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, personId),
    );
    const paths = person.map((field) => field.fieldPath);
    expect(paths).toContain('person.name');
    // True of this person in this company only, so the path carries the company.
    expect(paths).toContain(`manager.positions.${companyId}`);
  });

  it('links two companies through the manager they share', async () => {
    const result = await run('CR_FULL', { unn: SANDBOX_UNN.SUSPENDED }, [
      { idType: 'UNN', value: SANDBOX_UNN.SUSPENDED },
    ]);
    suspendedId = result.entityId ?? '';
    expect(suspendedId).not.toBe(companyId);

    const first = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getRelations(tx, companyId),
    );
    const second = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getRelations(tx, suspendedId),
    );
    const people = (edges: typeof first) =>
      new Set(edges.filter((edge) => edge.relType === 'MANAGES').map((edge) => edge.toEntity));
    const shared = [...people(first)].filter((id) => people(second).has(id));
    expect(shared.length).toBeGreaterThan(0);
  });

  it("records a manager's powers in that company from the manager check", async () => {
    const result = await run(
      'MANAGER_AUTHORITY',
      { unn: SANDBOX_UNN.ACTIVE, manager_id: SANDBOX_MANAGER_ID },
      [{ idType: 'UNN', value: SANDBOX_UNN.ACTIVE }],
    );
    expect(result.status).toBe('OK');
    expect(result.entityId).toBe(companyId);

    const relations = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getRelations(tx, companyId),
    );
    const personIds = relations
      .filter((relation) => relation.relType === 'MANAGES')
      .map((relation) => relation.toEntity);
    let found = false;
    for (const personId of personIds) {
      const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
        getEntityProfile(tx, personId),
      );
      const powers = profile.find(
        (field) => field.fieldPath === `manager.permissions.${companyId}`,
      );
      if (powers) {
        found = true;
        expect(Array.isArray(powers.value)).toBe(true);
      }
    }
    expect(found).toBe(true);
  });

  it('fills the address section and keys it for comparison', async () => {
    await run('NATIONAL_ADDRESS', { unn: SANDBOX_UNN.ACTIVE }, [
      { idType: 'UNN', value: SANDBOX_UNN.ACTIVE },
    ]);
    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, companyId),
    );
    const paths = profile.map((field) => field.fieldPath);
    expect(paths).toContain('address.national.city');
    expect(paths).toContain('address.national.key');
    expect(profile.find((field) => field.fieldPath === 'address.national.city')?.authority).toBe(
      'العنوان الوطني',
    );
  });

  it('answers not found for the articles of a sole establishment', async () => {
    const result = await run('ARTICLES_OF_ASSOCIATION', { unn: SANDBOX_UNN.ESTABLISHMENT }, [
      { idType: 'UNN', value: SANDBOX_UNN.ESTABLISHMENT },
    ]);
    // The source has no articles for a sole establishment, and says so.
    expect(result.status).toBe('NOT_FOUND');
  });

  it('makes the IBAN an account of its own, linked to the customer, with the result for them', async () => {
    const result = await run(
      'IBAN_VERIFICATION',
      { iban: SANDBOX_IBAN.MATCH, account_type: 'BUSINESS', unn: SANDBOX_UNN.ACTIVE },
      [{ idType: 'UNN', value: SANDBOX_UNN.ACTIVE }],
    );
    expect(result.status).toBe('OK');

    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, companyId),
    );
    expect(profile.find((field) => field.fieldPath === 'bank.iban_ownership')?.value).toBe('MATCH');

    const relations = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getRelations(tx, companyId),
    );
    const account = relations.find((relation) => relation.relType === 'HOLDS_ACCOUNT');
    expect(account).toBeDefined();
    const accountProfile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, account?.toEntity ?? ''),
    );
    expect(accountProfile.map((field) => field.fieldPath)).toContain(
      `account.ownership.${companyId}`,
    );
  });

  it('makes a freelancer a customer, current until the certificate expires', async () => {
    const result = await run(
      'FREELANCE_CERTIFICATE',
      {
        national_id: SANDBOX_FREELANCER.NATIONAL_ID,
        certificate_number: SANDBOX_FREELANCER.ACTIVE,
      },
      [
        { idType: 'NATIONAL_ID', value: SANDBOX_FREELANCER.NATIONAL_ID },
        { idType: 'FREELANCE_DOC', value: SANDBOX_FREELANCER.ACTIVE },
      ],
    );
    expect(result.status).toBe('OK');
    const profile = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      getEntityProfile(tx, result.entityId ?? ''),
    );
    const status = profile.find((field) => field.fieldPath === 'freelance.certificate_status');
    expect(status?.value).toBe('ACTIVE');
    // The authority's own expiry, not an estimate from a policy.
    expect(status?.effectiveUntil?.toISOString().slice(0, 10)).toBe('2027-08-21');
  });

  it('refuses a check the source has not enabled, before any charge', async () => {
    await expect(
      run('PROPERTY_VERIFICATION', { property_number: '7660081406600000' }, [
        { idType: 'REAL_ESTATE_NO', value: '7660081406600000' },
      ]),
    ).rejects.toMatchObject({ code: 'NX-4031' });
  });

  it('stores no identifier in clear anywhere', async () => {
    for (const value of [
      SANDBOX_MANAGER_ID,
      '1010711252',
      SANDBOX_IBAN.MATCH,
      SANDBOX_FREELANCER.NATIONAL_ID,
    ]) {
      const hits = await withTenant(db.migratorPool, tenant.tenantId, (tx) =>
        scanForPlaintext(tx, value),
      );
      expect(hits, value).toEqual([]);
    }
  });
});
