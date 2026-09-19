import { beforeAll, describe, expect, it } from 'vitest';
import {
  BINDING_CREDENTIAL_UNSEALED,
  listOperatorAudit,
  listTenantBindings,
  setTenantBinding,
  upsertCatalogEntry,
} from '../src/index.js';
import { readAudit } from '../src/auth/audit.js';
import { withTenant } from '../../../packages/db/src/client.js';
import { createTestDatabase, seedTenant, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * Changing whose account a subscriber runs on, from the panel (ADR-172).
 *
 * Two things this covers that the routing suite beside it does not. The change belongs in the
 * panel's own trail as well as the subscriber's, because «كل تغيير أجراه الفريق» is what the
 * panel screen promises and moving a subscriber onto our credential is the change on that page
 * that costs the platform money. And a reference with nothing sealed behind it is refused while
 * somebody is still looking at the screen, rather than at the subscriber's next verification.
 */

const PROVIDER = 'wathq-binding-test';
const OPERATOR = 'a2f1d4c8-0e25-4d6a-9f13-7c5b2e8a4d90';
const SEALED = 'kms://tenants/byoc/sealed';

/** A store that holds one reference, asked the way the panel asks the real one. */
const credentialExists = (ref: string): Promise<boolean> => Promise.resolve(ref === SEALED);

describe('binding a subscriber to its own credential', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await upsertCatalogEntry(db.operatorPool, {
      code: PROVIDER,
      nameAr: 'مصدر الاختبار',
      nameEn: 'Test source',
      endpoints: ['cr_basic'],
      status: 'active',
      notes: null,
    });
  });

  /** Every operator_audit row written for one subscriber, newest first. */
  const panelTrail = async (tenantId: string) =>
    (
      await listOperatorAudit(db.operatorPool, { targetPrefixes: [`subscriber:${tenantId}`] })
    ).filter((row) => row.action === 'routing.binding_set');

  it('records the change in the panel trail as well as the subscriber trail', async () => {
    const tenant = await seedTenant(db.appPool, 'Binding Trail');

    await setTenantBinding(
      db.operatorPool,
      { tenantId: tenant.tenantId, provider: PROVIDER, mode: 'BYOC', credentialRef: SEALED },
      OPERATOR,
      { credentialExists },
    );

    const panel = await panelTrail(tenant.tenantId);
    expect(panel).toHaveLength(1);
    expect(panel[0]?.operatorId).toBe(OPERATOR);
    expect(panel[0]?.target).toBe(`subscriber:${tenant.tenantId}`);
    expect(panel[0]?.metadata['mode']).toBe('BYOC');
    // The pointer is recorded. Nothing the pointer resolves to ever is (rule 10).
    expect(panel[0]?.metadata['credential_ref']).toBe(SEALED);

    // The subscriber's own trail still carries it too, because it is a change to their account,
    // and it is read the way the subscriber reads it: on their connection, under their policy.
    const theirs = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      readAudit(tx, { action: 'provider.binding_set' }),
    );
    expect(theirs.map((entry) => entry.actorId)).toEqual([OPERATOR]);
    expect(theirs[0]?.actorType).toBe('NX_STAFF');
  });

  it('refuses a reference with nothing sealed behind it, and writes nothing at all', async () => {
    const tenant = await seedTenant(db.appPool, 'Pointer At Nothing');

    // Well formed, accepted by every other check, and fatal: resolveCredential fetches the
    // reference at the first step and the store raises, so every verification this subscriber
    // asks for breaks, and nothing between the save and that call says so.
    await expect(
      setTenantBinding(
        db.operatorPool,
        {
          tenantId: tenant.tenantId,
          provider: PROVIDER,
          mode: 'BYOC',
          credentialRef: 'kms://tenants/byoc/never-sealed',
        },
        OPERATOR,
        { credentialExists },
      ),
    ).rejects.toMatchObject({
      code: 'NX-4001',
      message: expect.stringContaining(BINDING_CREDENTIAL_UNSEALED),
    });

    expect(await listTenantBindings(db.operatorPool, tenant.tenantId)).toEqual([]);
    expect(await panelTrail(tenant.tenantId)).toEqual([]);
  });

  it('checks a managed binding that names a reference, and lets one that names none through', async () => {
    const tenant = await seedTenant(db.appPool, 'Managed Pointer');

    // MANAGED with a dangling reference fails at the same first call, so it gets the same
    // refusal: the mode decides who pays, not whether the pointer has to resolve.
    await expect(
      setTenantBinding(
        db.operatorPool,
        {
          tenantId: tenant.tenantId,
          provider: PROVIDER,
          mode: 'MANAGED',
          credentialRef: 'kms://nx/providers/never-sealed',
        },
        OPERATOR,
        { credentialExists },
      ),
    ).rejects.toMatchObject({ code: 'NX-4001' });

    // A managed binding with no reference of its own falls through to the platform connection
    // for the environment of this workspace, which is the ordinary case and asks the store
    // nothing.
    await setTenantBinding(
      db.operatorPool,
      { tenantId: tenant.tenantId, provider: PROVIDER, mode: 'MANAGED' },
      OPERATOR,
      { credentialExists },
    );
    expect((await listTenantBindings(db.operatorPool, tenant.tenantId))[0]?.mode).toBe('MANAGED');
  });

  it('asks no store when the deployment has none to ask', async () => {
    const tenant = await seedTenant(db.appPool, 'Unaskable Store');

    // A deployment whose store cannot describe what it holds passes no check. Refusing every
    // reference because this process cannot look one up would make the screen unusable there,
    // and the screen says so in its own words rather than pretending it checked.
    await setTenantBinding(
      db.operatorPool,
      {
        tenantId: tenant.tenantId,
        provider: PROVIDER,
        mode: 'BYOC',
        credentialRef: 'kms://tenants/byoc/unchecked',
      },
      OPERATOR,
    );
    expect((await listTenantBindings(db.operatorPool, tenant.tenantId))[0]?.mode).toBe('BYOC');
  });
});
