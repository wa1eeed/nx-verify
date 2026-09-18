import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  CAPABILITIES,
  ROLE_PRESETS,
  capabilitiesOf,
  countAdministrators,
  resolveCapabilities,
  setUserCapability,
} from '../src/auth/capabilities.js';
import { createUser, disableUser, setUserRole, USER_ROLES } from '../src/auth/users.js';
import type { Capability } from '../src/auth/capabilities.js';
import type { UserRole } from '../src/auth/users.js';
import { createTestDatabase, seedTenant, type TestDatabase } from '../../../test/helpers/db.js';

/**
 * What the customer's own people may do.
 *
 * Two things are worth pinning down here. The first is that the catalogue in the code and
 * the rows in the database say the same thing, because the four eyes trigger reads the rows
 * and every screen reads the code: the day they disagree is the day somebody sees a button
 * the database refuses. The second is that a workspace can never be left with nobody who can
 * administer it, since that is the one mistake on this screen that the subscriber cannot undo
 * themselves.
 */

describe('capabilities', () => {
  let db: TestDatabase;
  let tenantId: string;
  let adminId: string;

  const asTenant = <T>(handler: Parameters<typeof withTenant<T>>[2]): Promise<T> =>
    withTenant(db.appPool, tenantId, handler);

  const add = (email: string, role: UserRole): Promise<string> =>
    asTenant((tx) => createUser(tx, { email, displayName: email, role }, adminId));

  beforeAll(async () => {
    db = await createTestDatabase();
    const tenant = await seedTenant(db.appPool, 'شركة الصلاحيات');
    tenantId = tenant.tenantId;
    adminId = await withTenant(db.appPool, tenantId, (tx) =>
      createUser(tx, { email: 'owner@caps.example.sa', displayName: 'المالك', role: 'ADMIN' }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('says the same thing in the code and in the database', async () => {
    // Migration 0060 carries these rows and this file carries the same list. A test rather
    // than a comment, because the trigger asks the database and the console asks the code.
    const catalogue = await db.appPool.query<{ code: string; name_ar: string; spends: boolean }>(
      `SELECT code, name_ar, spends FROM capabilities ORDER BY code`,
    );
    expect(catalogue.rows.map((row) => row.code)).toEqual(
      [...CAPABILITIES].map((entry) => entry.code).sort(),
    );
    for (const row of catalogue.rows) {
      const entry = CAPABILITIES.find((item) => item.code === row.code);
      expect(entry?.nameAr).toBe(row.name_ar);
      expect(entry?.spends).toBe(row.spends);
    }

    const presets = await db.appPool.query<{ role: string; capability: string }>(
      `SELECT role, capability FROM role_capabilities`,
    );
    for (const role of USER_ROLES) {
      const inDatabase = presets.rows
        .filter((row) => row.role === role)
        .map((row) => row.capability)
        .sort();
      expect(inDatabase).toEqual([...ROLE_PRESETS[role]].sort());
    }
  });

  it('gives finance the wallet and not the customers', async () => {
    // The whole argument for this file: somebody who pays invoices has no business reading
    // the commercial registration and the national id of every company ever checked.
    const financeId = await add('finance@caps.example.sa', 'FINANCE');
    const held = await asTenant((tx) => capabilitiesOf(tx, financeId));

    expect(held.has('wallet.read')).toBe(true);
    expect(held.has('wallet.topup')).toBe(true);
    expect(held.has('customers.read')).toBe(false);
    expect(held.has('verify.run')).toBe(false);
  });

  it('gives compliance the decisions and not the spending', async () => {
    const complianceId = await add('compliance@caps.example.sa', 'COMPLIANCE');
    const held = await asTenant((tx) => capabilitiesOf(tx, complianceId));

    expect(held.has('review.decide')).toBe(true);
    expect(held.has('review.approve')).toBe(true);
    expect(held.has('rules.manage')).toBe(true);
    expect(held.has('verify.run')).toBe(false);
  });

  it('hands one extra permission to one person without inventing a role for them', async () => {
    const clerkId = await add('clerk@caps.example.sa', 'ANALYST');
    expect((await asTenant((tx) => capabilitiesOf(tx, clerkId))).has('wallet.topup')).toBe(false);

    await asTenant((tx) =>
      setUserCapability(tx, {
        userId: clerkId,
        capability: 'wallet.topup',
        granted: true,
        actorId: adminId,
      }),
    );

    expect((await asTenant((tx) => capabilitiesOf(tx, clerkId))).has('wallet.topup')).toBe(true);
  });

  it('takes one away from somebody whose job otherwise carries it', async () => {
    const juniorId = await add('junior@caps.example.sa', 'ANALYST');
    await asTenant((tx) =>
      setUserCapability(tx, {
        userId: juniorId,
        capability: 'verify.run',
        granted: false,
        actorId: adminId,
      }),
    );

    const held = await asTenant((tx) => capabilitiesOf(tx, juniorId));
    expect(held.has('verify.run')).toBe(false);
    // Taking away the one that spends leaves the rest of the job intact.
    expect(held.has('customers.read')).toBe(true);
    expect(held.has('review.decide')).toBe(true);
  });

  it('returns somebody to their preset', async () => {
    const backId = await add('back@caps.example.sa', 'ANALYST');
    const change = (granted: boolean | null) =>
      asTenant((tx) =>
        setUserCapability(tx, {
          userId: backId,
          capability: 'verify.run',
          granted,
          actorId: adminId,
        }),
      );

    await change(false);
    expect((await asTenant((tx) => capabilitiesOf(tx, backId))).has('verify.run')).toBe(false);
    await change(null);
    expect((await asTenant((tx) => capabilitiesOf(tx, backId))).has('verify.run')).toBe(true);
  });

  it('keeps an exception when the role under it changes', async () => {
    // An administrator who deliberately took the spending away from one person meant it, and
    // a promotion is not a reason to hand it back without telling them.
    const keptId = await add('kept@caps.example.sa', 'ANALYST');
    await asTenant((tx) =>
      setUserCapability(tx, {
        userId: keptId,
        capability: 'verify.run',
        granted: false,
        actorId: adminId,
      }),
    );
    await asTenant((tx) => setUserRole(tx, keptId, 'APPROVER', adminId));

    const held = await asTenant((tx) => capabilitiesOf(tx, keptId));
    expect(held.has('review.approve')).toBe(true);
    expect(held.has('verify.run')).toBe(false);
  });

  it('holds nothing at all once the account is disabled', async () => {
    const goneId = await add('gone@caps.example.sa', 'ADMIN');
    await asTenant((tx) => disableUser(tx, goneId, adminId));
    const held = await asTenant((tx) => capabilitiesOf(tx, goneId));
    // Which is what makes disabling somebody a complete answer rather than a flag every
    // screen has to remember to check.
    expect(held.size).toBe(0);
  });

  it('refuses to leave the workspace with nobody who can administer it', async () => {
    const soloTenant = await seedTenant(db.appPool, 'شركة بمسؤول واحد');
    const soloAdmin = await withTenant(db.appPool, soloTenant.tenantId, (tx) =>
      createUser(tx, { email: 'solo@caps.example.sa', displayName: 'وحيد', role: 'ADMIN' }),
    );
    const solo = <T>(handler: Parameters<typeof withTenant<T>>[2]): Promise<T> =>
      withTenant(db.appPool, soloTenant.tenantId, handler);

    await expect(solo((tx) => setUserRole(tx, soloAdmin, 'FINANCE', soloAdmin))).rejects.toMatchObject(
      { code: 'NX-4091' },
    );
    await expect(
      solo((tx) =>
        setUserCapability(tx, {
          userId: soloAdmin,
          capability: 'users.manage',
          granted: false,
          actorId: soloAdmin,
        }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4003' });

    expect(await solo((tx) => countAdministrators(tx))).toBe(1);
  });

  it('counts whoever actually administers, not whoever is called an administrator', async () => {
    const countTenant = await seedTenant(db.appPool, 'شركة العدّ');
    const scope = <T>(handler: Parameters<typeof withTenant<T>>[2]): Promise<T> =>
      withTenant(db.appPool, countTenant.tenantId, handler);
    const first = await scope((tx) =>
      createUser(tx, { email: 'a@count.example.sa', displayName: 'أ', role: 'ADMIN' }),
    );
    const second = await scope((tx) =>
      createUser(tx, { email: 'b@count.example.sa', displayName: 'ب', role: 'VIEWER' }, first),
    );

    expect(await scope((tx) => countAdministrators(tx))).toBe(1);

    await scope((tx) =>
      setUserCapability(tx, {
        userId: second,
        capability: 'users.manage',
        granted: true,
        actorId: first,
      }),
    );
    expect(await scope((tx) => countAdministrators(tx))).toBe(2);

    // And now the first one may step down, because somebody else is holding the door.
    await scope((tx) => setUserRole(tx, first, 'FINANCE', first));
    expect(await scope((tx) => countAdministrators(tx))).toBe(1);
  });

  it('resolves the same set in the code as the database does', async () => {
    // The console computes a whole workspace's switches from the role and the exceptions
    // rather than querying per person. This is that shortcut, checked against the source.
    const mixedId = await add('mixed@caps.example.sa', 'FINANCE');
    await asTenant((tx) =>
      setUserCapability(tx, {
        userId: mixedId,
        capability: 'customers.read',
        granted: true,
        actorId: adminId,
      }),
    );
    await asTenant((tx) =>
      setUserCapability(tx, {
        userId: mixedId,
        capability: 'prices.manage',
        granted: false,
        actorId: adminId,
      }),
    );

    const fromDatabase = await asTenant((tx) => capabilitiesOf(tx, mixedId));
    const inCode = resolveCapabilities('FINANCE', {
      'customers.read': true,
      'prices.manage': false,
    });
    expect([...fromDatabase].sort()).toEqual([...inCode].sort());
  });

  it('refuses a capability that is not one, at the database and not only in TypeScript', async () => {
    await expect(
      db.appPool.query(
        `INSERT INTO user_capabilities (tenant_id, user_id, capability, granted)
         VALUES ($1, $2, 'everything', true)`,
        [tenantId, adminId],
      ),
    ).rejects.toThrow();
  });

  it('keeps every capability in the catalogue reachable from some preset', async () => {
    // A permission no role carries is a permission nobody can be given without an exception,
    // which usually means it was added and forgotten rather than designed.
    const reachable = new Set<Capability>();
    for (const role of USER_ROLES) {
      for (const capability of ROLE_PRESETS[role]) {
        reachable.add(capability);
      }
    }
    expect([...reachable].sort()).toEqual(CAPABILITIES.map((entry) => entry.code).sort());
  });
});

describe('a workspace that already has no administrator', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('can still be repaired, because the rule protects the last one and not the absence', async () => {
    // Provisioning older than this screen, or an administrator removed some other way. A
    // guard that refused every change here would freeze the workspace in the state it was
    // meant to prevent, and the way out would be us reaching into their database.
    const tenant = await seedTenant(db.appPool, 'شركة بلا مسؤول');
    const scope = <T>(handler: Parameters<typeof withTenant<T>>[2]): Promise<T> =>
      withTenant(db.appPool, tenant.tenantId, handler);

    const orphan = await scope((tx) =>
      createUser(tx, { email: 'orphan@caps.example.sa', displayName: 'وحيد', role: 'ANALYST' }),
    );
    expect(await scope((tx) => countAdministrators(tx))).toBe(0);

    await scope((tx) =>
      setUserCapability(tx, {
        userId: orphan,
        capability: 'users.manage',
        granted: true,
        actorId: orphan,
      }),
    );
    expect(await scope((tx) => countAdministrators(tx))).toBe(1);
  });
});
