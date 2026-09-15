import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../../packages/db/src/client.js';
import { runChecks, type RunChecksDependencies } from '../src/customers/checks.js';
import { getCustomerFile } from '../src/customers/customer-file.js';
import {
  findPartiesByIdentifier,
  getPartyMentions,
  getPartyRoles,
  summarizeParties,
} from '../src/customers/parties.js';
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
  SANDBOX_MANAGER_ID,
  SANDBOX_UNN,
} from '../../../packages/providers/src/stub/verification-sandbox.js';

/**
 * The related parties (the owner's ask), on real data.
 *
 * Three companies of the sandbox are verified the way the console verifies them: an active one
 * in full, one whose registration is suspended and one in liquidation. The same manager stands
 * behind all three, a partner endowment is named by its deed, and the company in liquidation
 * names a liquidator. The list and the file of a party are read back, and nothing of it is
 * visible to another subscriber.
 */

describe('the related parties', () => {
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
  const verify = async (unn: string, productCodes: string[]): Promise<string> => {
    const result = await runChecks(depsFor(tenant.tenantId), {
      kind: 'BUSINESS',
      identity: { unn },
      productCodes,
      inputs: { iban: SANDBOX_IBAN.MATCH },
      bundleKey: randomUUID(),
      requestedBy: null,
    });
    return result.entityId ?? '';
  };
  const inTenant = <T>(work: Parameters<typeof withTenant<T>>[2]): Promise<T> =>
    withTenant(db.appPool, tenant.tenantId, work);

  let active = '';
  let suspended = '';
  let liquidating = '';

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Parties Tenant');
    other = await seedTenant(db.appPool, 'Another Subscriber');
    await preparePricedTenant(db, tenant.tenantId, { balanceHalalas: 50_000_00 });
    await preparePricedTenant(db, other.tenantId, { balanceHalalas: 50_000_00 });
    active = await verify(SANDBOX_UNN.ACTIVE, [
      'CR_FULL',
      'ARTICLES_OF_ASSOCIATION',
      'MANAGER_AUTHORITY',
    ]);
    suspended = await verify(SANDBOX_UNN.SUSPENDED, ['CR_FULL']);
    liquidating = await verify(SANDBOX_UNN.IN_LIQUIDATION, ['CR_FULL']);
  });

  afterAll(async () => {
    await db.close();
  });

  const manager = async () =>
    (await inTenant((tx) => summarizeParties(tx, keys))).find(
      (party) => party.identifier?.display === SANDBOX_MANAGER_ID,
    );

  it('lists each party once, with the number in full and every company they stand behind', async () => {
    const party = await manager();
    expect(party?.entityType).toBe('PERSON');
    expect(party?.identifier).toEqual({
      idType: 'NATIONAL_ID',
      labelAr: 'هوية',
      display: SANDBOX_MANAGER_ID,
    });
    expect(party?.nationality).toBe('سعودي');
    expect(new Set(party?.companies.map((company) => company.entityId))).toEqual(
      new Set([active, suspended, liquidating]),
    );
    expect(party?.roleCounts.MANAGER).toBe(3);
    expect(party?.roleCounts.PARTNER).toBe(3);
  });

  it('says how much authority of a manager is proven, and which of their companies needs a look', async () => {
    const party = await manager();
    // Their powers were verified in the active company only.
    expect(party?.authority).toEqual({ verified: 1, checkable: 3 });
    const standing = new Map(
      party?.companies.map((company) => [company.entityId, company.standing]),
    );
    expect(standing.get(active)).toBe('ACTIVE');
    expect(standing.get(suspended)).toBe('INACTIVE');
    expect(standing.get(liquidating)).toBe('LIQUIDATION');
    expect(party?.concerns).toBe(2);
  });

  it('keeps an organisation and a liquidator as parties of their own', async () => {
    const parties = await inTenant((tx) => summarizeParties(tx, keys));
    const endowment = parties.find((party) => party.displayName === 'وقف');
    expect(endowment).toMatchObject({
      entityType: 'BUSINESS',
      identifier: { idType: 'PARTY_ID', labelAr: 'رقم صك الوقف', display: '7111111111' },
      roleCounts: { PARTNER: 1 },
      authority: { verified: 0, checkable: 0 },
    });
    const liquidator = parties.find((party) => party.roleCounts.LIQUIDATOR > 0);
    expect(liquidator).toMatchObject({
      displayName: 'عبدالله سالم هليل الشمري',
      identifier: { idType: 'IQAMA', display: '2345678901' },
      companies: [expect.objectContaining({ entityId: liquidating, standing: 'LIQUIDATION' })],
    });
  });

  it('finds a party by number through its keyed hash, a document number included', async () => {
    const byId = await inTenant((tx) => findPartiesByIdentifier(tx, keys, SANDBOX_MANAGER_ID));
    expect(byId).toEqual([(await manager())?.entityId]);
    const byDeed = await inTenant((tx) => findPartiesByIdentifier(tx, keys, '7111111111'));
    expect(byDeed).toHaveLength(1);
    expect(await inTenant((tx) => findPartiesByIdentifier(tx, keys, 'x'))).toEqual([]);
  });

  it('draws the file of a party as its roles, company by company, with what deserves a look', async () => {
    const party = await manager();
    const roles = await inTenant((tx) => getPartyRoles(tx, keys, party?.entityId ?? ''));
    const inActive = roles.roles.filter((role) => role.company.entityId === active);
    expect(inActive.map((role) => role.role)).toEqual(['MANAGER', 'PARTNER']);
    const managing = inActive.find((role) => role.role === 'MANAGER');
    expect(managing?.permissions?.length).toBeGreaterThan(0);
    expect(managing?.typeText).toBe('سعودي');
    expect(managing?.licensed).toBe(true);
    expect(managing?.checkable).toBe(true);
    const partnering = inActive.find((role) => role.role === 'PARTNER');
    expect(partnering).toMatchObject({ shares: 500, cashShares: 250, inKindShares: 250 });

    expect(roles.concerns.map((concern) => concern.textAr)).toEqual([
      'مرتبط بمنشأة تحت التصفية',
      'مرتبط بمنشأة سجلها غير فعّال',
      'صلاحياته في منشأتين لم يُتحقق منها',
    ]);
  });

  it('opens as a related party, never with the sections of a company', async () => {
    const party = await manager();
    const file = await inTenant((tx) => getCustomerFile(tx, keys, party?.entityId ?? ''));
    expect(file?.kindLabelAr).toBe('طرف ذو علاقة');
    expect(file?.sections.map((section) => [section.section, section.requirement])).toEqual([
      ['REGISTRY', 'REQUIRED'],
    ]);
  });

  it('keeps the record of the verifications that named them, each fact once', async () => {
    const party = await manager();
    const mentions = await inTenant((tx) => getPartyMentions(tx, party?.entityId ?? ''));
    expect(new Set(mentions.map((mention) => mention.company.entityId))).toEqual(
      new Set([active, suspended, liquidating]),
    );
    for (const mention of mentions) {
      const paths = mention.fields.map((field) => field.fieldPath);
      expect(new Set(paths).size, mention.productCode).toBe(paths.length);
    }
  });

  it('shows another subscriber none of it', async () => {
    expect(
      await withTenant(db.appPool, other.tenantId, (tx) => summarizeParties(tx, keys)),
    ).toEqual([]);
    expect(
      await withTenant(db.appPool, other.tenantId, (tx) =>
        findPartiesByIdentifier(tx, keys, SANDBOX_MANAGER_ID),
      ),
    ).toEqual([]);
  });
});
