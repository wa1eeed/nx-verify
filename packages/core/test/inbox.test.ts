import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, withoutTenant } from '../../../packages/db/src/client.js';
import { applyProductSeed } from '../../../packages/db/src/seed/products.js';
import {
  createTestDatabase,
  insertAttestation,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { createUser } from '../src/auth/users.js';
import { ensureWallet, topUp } from '../src/billing/wallet.js';
import { inboxSeenAt, listInbox, markInboxSeen } from '../src/notifications/inbox.js';

/**
 * Unit 70 acceptance: one place for what needs attention, and an unread count that means
 * something.
 *
 * The inbox is assembled from the rows that already hold these facts rather than copied
 * into a table of its own, so the test that matters is that it reflects the state of
 * those rows rather than a snapshot of them.
 */

describe('the notification centre', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let userId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Inbox Tenant');
    await withoutTenant(db.appPool, (tx) => applyProductSeed(tx));
    // A change event points at the attestation that caused it, so there has to be one.
    await insertAttestation(db.appPool, tenant);
    userId = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      await ensureWallet(tx);
      return createUser(tx, { email: 'a@inbox.sa', displayName: 'أ', role: 'ADMIN' });
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('says nothing is waiting when nothing is', async () => {
    const inbox = await withTenant(db.appPool, tenant.tenantId, (tx) => listInbox(tx));
    expect(inbox.items).toHaveLength(0);
    expect(inbox.unread).toBe(0);
  });

  it('shows an unhandled change, and stops showing it once it is handled', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(
        `INSERT INTO change_events (tenant_id, entity_id, field_path, new_attestation,
                                    severity, detected_at)
         SELECT $1, $2, 'cr.status', a.id, 'CRITICAL', now()
         FROM attestations a WHERE a.tenant_id = $1 LIMIT 1`,
        [tx.tenantId, tenant.entityId],
      ),
    );

    const withChange = await withTenant(db.appPool, tenant.tenantId, (tx) => listInbox(tx));
    expect(withChange.items.map((item) => item.kind)).toContain('change');
    const item = withChange.items.find((entry) => entry.kind === 'change');
    expect(item?.severity).toBe('critical');
    // Every row goes somewhere. A notification you cannot act on from makes somebody hunt
    // for the screen it meant.
    expect(item?.href).toBe(`/entities/${tenant.entityId}`);
    // Rule 4: no identifier reaches a notification, on screen or in a message.
    expect(`${item?.titleAr} ${item?.detailAr ?? ''}`).not.toMatch(/\d{10}/);

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(`UPDATE change_events SET acknowledged_at = now() WHERE tenant_id = $1`, [
        tx.tenantId,
      ]),
    );
    const handled = await withTenant(db.appPool, tenant.tenantId, (tx) => listInbox(tx));
    // Assembled on read, so handling it anywhere removes it here with no second write.
    expect(handled.items.map((entry) => entry.kind)).not.toContain('change');
  });

  it('counts only what arrived after this person last looked', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(
        `INSERT INTO change_events (tenant_id, entity_id, field_path, new_attestation,
                                    severity, detected_at)
         SELECT $1, $2, 'cr.capital', a.id, 'INFO', now() - interval '1 hour'
         FROM attestations a WHERE a.tenant_id = $1 LIMIT 1`,
        [tx.tenantId, tenant.entityId],
      ),
    );

    const before = await withTenant(db.appPool, tenant.tenantId, (tx) => listInbox(tx));
    expect(before.unread).toBe(before.items.length);

    await withTenant(db.appPool, tenant.tenantId, (tx) => markInboxSeen(tx, userId));
    const seen = await withTenant(db.appPool, tenant.tenantId, async (tx) =>
      listInbox(tx, { seenAt: await inboxSeenAt(tx, userId) }),
    );
    expect(seen.unread).toBe(0);
    // Seen is not deleted: the list is still there to read.
    expect(seen.items.length).toBe(before.items.length);

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(
        `INSERT INTO change_events (tenant_id, entity_id, field_path, new_attestation,
                                    severity, detected_at)
         SELECT $1, $2, 'cr.core.name', a.id, 'WARNING', now() + interval '1 minute'
         FROM attestations a WHERE a.tenant_id = $1 LIMIT 1`,
        [tx.tenantId, tenant.entityId],
      ),
    );
    const after = await withTenant(db.appPool, tenant.tenantId, async (tx) =>
      listInbox(tx, { seenAt: await inboxSeenAt(tx, userId) }),
    );
    expect(after.unread).toBe(1);
  });

  it('warns on a low balance and not on a healthy one', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) => topUp(tx, { amount: 1_000_00, vatInvoiceId: 'INV-INBOX' }));
    const healthy = await withTenant(db.appPool, tenant.tenantId, (tx) => listInbox(tx));
    expect(healthy.items.map((item) => item.kind)).not.toContain('balance');

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query(`UPDATE wallets SET low_threshold = 1 WHERE tenant_id = $1`, [tx.tenantId]),
    );
    const low = await withTenant(db.appPool, tenant.tenantId, (tx) => listInbox(tx));
    expect(low.items.map((item) => item.kind)).toContain('balance');
  });

  it('keeps one workspace inbox invisible to another', async () => {
    const other = await seedTenant(db.appPool, 'Other Inbox Tenant');
    await withTenant(db.appPool, other.tenantId, (tx) => ensureWallet(tx));
    const seen = await withTenant(db.appPool, other.tenantId, (tx) => listInbox(tx));
    expect(seen.items).toHaveLength(0);
  });
});
