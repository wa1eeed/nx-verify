import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { ensureWallet, getWallet } from '../src/billing/wallet.js';
import {
  confirmTopUp,
  listPendingTopUps,
  listTopUpRequests,
  rejectTopUp,
  requestTopUp,
} from '../src/billing/topups.js';

/**
 * Unit 65 acceptance: money goes in once, and only after it arrived.
 *
 * The test that matters is the double confirmation. Two people reconciling the same bank
 * statement will press the same button, and the difference between one credit and two is
 * an afternoon nobody gets back.
 */

describe('topping up by transfer', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Paying Tenant');
    await withTenant(db.appPool, tenant.tenantId, (tx) => ensureWallet(tx));
  });

  afterAll(async () => {
    await db.close();
  });

  it('gives the subscriber a reference and the amount to actually send', async () => {
    const request = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      requestTopUp(tx, { amountHalalas: 1_000_00, note: 'تحويل بنكي' }),
    );

    expect(request.reference).toMatch(/^TOP-\d{4}-\d{6}$/);
    expect(request.amountHalalas).toBe(1_000_00);
    // The platform is not registered for VAT, so none is due and none is added. This test
    // used to assert a flat fifteen percent, which is how the platform came to be charging
    // subscribers a tax it had no registration to collect (ADR-157).
    expect(request.totalWithVatHalalas).toBe(1_000_00);
    expect(request.status).toBe('REQUESTED');
  });

  it('adds the tax once the platform is registered, and never to what came before', async () => {
    const { setVatPeriod } = await import('../src/billing/vat.js');

    // A transfer from last year, which is the case this whole design exists for: whatever we
    // do about tax afterwards, that request was for a thousand riyals and stays so.
    const old = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      requestTopUp(tx, { amountHalalas: 1_000_00 }),
    );
    // Backdated in the tenant's own scope: row level security is forced, so even the owner
    // role sees nothing without a tenant set, and this fixture needs the row it just made.
    const moved = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(
        `UPDATE topup_requests SET requested_at = now() - interval '400 days'
          WHERE tenant_id = $1 AND reference = $2`,
        [tx.tenantId, old.reference],
      ),
    );
    expect(moved.rowCount).toBe(1);

    await setVatPeriod(
      db.operatorPool,
      { id: 'op-vat', displayName: 'مالك', role: 'OWNER' },
      {
        effectiveFrom: new Date().toISOString().slice(0, 10),
        registered: true,
        rateBps: 1500,
        registrationNumber: '300000000000003',
      },
    );

    const now = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      requestTopUp(tx, { amountHalalas: 1_000_00 }),
    );
    expect(now.totalWithVatHalalas).toBe(1_150_00);

    // Read today, under today's rule, and still untaxed: an invoice does not change.
    const all = await withTenant(db.appPool, tenant.tenantId, (tx) => listTopUpRequests(tx));
    expect(all.find((row) => row.reference === old.reference)?.totalWithVatHalalas).toBe(1_000_00);
    expect(all.find((row) => row.reference === now.reference)?.totalWithVatHalalas).toBe(1_150_00);
  });

  it('moves no money on the request alone', async () => {
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      requestTopUp(tx, { amountHalalas: 500_00 }),
    );
    const after = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    // Crediting an intention means the first customer to change their mind spends money
    // that never left their bank.
    expect(after.balance).toBe(before.balance);
  });

  it('refuses to confirm without the tax invoice', async () => {
    const request = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      requestTopUp(tx, { amountHalalas: 200_00 }),
    );
    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        confirmTopUp(tx, { requestId: request.id, settledBy: 'nx-staff:test', vatInvoiceId: ' ' }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4001' });
  });

  it('credits once, however many times confirm is pressed', async () => {
    const request = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      requestTopUp(tx, { amountHalalas: 2_000_00 }),
    );
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      confirmTopUp(tx, {
        requestId: request.id,
        settledBy: 'nx-staff:test',
        vatInvoiceId: 'INV-2026-77',
      }),
    );

    await expect(
      withTenant(db.appPool, tenant.tenantId, (tx) =>
        confirmTopUp(tx, {
          requestId: request.id,
          settledBy: 'nx-staff:test',
          vatInvoiceId: 'INV-2026-77',
        }),
      ),
    ).rejects.toMatchObject({ code: 'NX-4091' });

    const after = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    expect(after.balance - before.balance).toBe(2_000_00);
  });

  it('leaves the tax invoice on the ledger row, where the statement reads it', async () => {
    const entries = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const result = await tx.query<{ vat_invoice_id: string | null; reason: string }>(
        `SELECT vat_invoice_id, reason FROM wallet_ledger ORDER BY created_at DESC LIMIT 1`,
      );
      return result.rows;
    });
    expect(entries[0]?.reason).toBe('TOPUP');
    expect(entries[0]?.vat_invoice_id).toBe('INV-2026-77');
  });

  it('lets a request be turned down without moving anything', async () => {
    const request = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      requestTopUp(tx, { amountHalalas: 300_00 }),
    );
    const before = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      rejectTopUp(tx, { requestId: request.id, settledBy: 'nx-staff:test', note: 'لم يصل' }),
    );

    const after = await withTenant(db.appPool, tenant.tenantId, (tx) => getWallet(tx));
    expect(after.balance).toBe(before.balance);

    const listed = await withTenant(db.appPool, tenant.tenantId, (tx) => listTopUpRequests(tx));
    expect(listed.find((item) => item.id === request.id)?.status).toBe('REJECTED');
  });

  it('shows staff what is waiting, across subscribers', async () => {
    const other = await seedTenant(db.appPool, 'Second Paying Tenant');
    await withTenant(db.appPool, other.tenantId, (tx) =>
      requestTopUp(tx, { amountHalalas: 750_00 }),
    );

    const pending = await listPendingTopUps(db.operatorPool);
    const names = pending.map((item) => item.tenantName);
    expect(names).toContain('Second Paying Tenant');
    // Every pending row and nothing settled.
    expect(pending.every((item) => item.status === 'REQUESTED')).toBe(true);
  });

  it('refuses an amount outside the band', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await expect(requestTopUp(tx, { amountHalalas: 50_00 })).rejects.toMatchObject({
        code: 'NX-4001',
      });
      await expect(requestTopUp(tx, { amountHalalas: 99_999_999_00 })).rejects.toMatchObject({
        code: 'NX-4001',
      });
    });
  });

  it('keeps one subscriber request invisible to another', async () => {
    const other = await seedTenant(db.appPool, 'Third Paying Tenant');
    const seen = await withTenant(db.appPool, other.tenantId, (tx) => listTopUpRequests(tx));
    expect(seen).toHaveLength(0);
  });
});
