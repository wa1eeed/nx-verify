import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import { verify } from '../../../packages/core/src/verification/verify.js';
import {
  addChannel,
  claimPendingNotifications,
  listChannels,
  queueNotifications,
  renderMessage,
  subscribe,
  unsubscribe,
  verifyChannel,
} from '../../../packages/core/src/notifications/notifications.js';
import {
  createTestDatabase,
  seedTenant,
  testKeys,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';
import { preparePricedTenant, providerFixture } from '../../../test/helpers/billing.js';
import { CollectingMailTransport, deliverNotifications, type MailTransport } from '../src/jobs/notifications.js';

/**
 * Unit 29 acceptance: a person is told, and the message tells them nothing.
 *
 * A notification leaves our custody the moment it is sent. Most of what follows is about
 * what must therefore not be in it, and about not sending to an address nobody proved.
 */

const PROVIDER_NAME = 'wathq-example-connector';
const SUBJECT_ID = '7001272184';

describe('notifications', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let channelId = '';
  const keys = testKeys();
  const fixture = providerFixture(PROVIDER_NAME);

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Notified Tenant');
    await preparePricedTenant(db, tenant.tenantId, { providerName: PROVIDER_NAME });

    channelId = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const id = await addChannel(tx, {
        address: 'compliance@client.example.sa',
        displayName: 'الامتثال',
        verified: true,
      });
      await subscribe(tx, { channelId: id, eventType: 'verification.completed' });
      await subscribe(tx, { channelId: id, eventType: 'entity.changed' });
      return id;
    });
  });

  afterAll(async () => {
    await db.close();
  });

  const pending = () =>
    withTenant(db.appPool, tenant.tenantId, (tx) => claimPendingNotifications(tx, 100));

  it('says what happened and where to look, and never what was found', () => {
    for (const event of [
      'verification.completed',
      'entity.changed',
      'attestation.expired',
      'wallet.low',
    ] as const) {
      const message = renderMessage(event, 'https://console.nx.sa');
      expect(message.subject).toBeTruthy();
      expect(message.body).toContain('https://console.nx.sa');
      // The three things that must never travel in a message we do not control.
      expect(message.body).not.toContain(SUBJECT_ID);
      expect(message.body.toLowerCase()).not.toContain(PROVIDER_NAME);
      expect(message.body).not.toMatch(/\d{10}/);
    }
  });

  it('queues one message per subscribed address when a verification runs', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      verify(tx, {
        productCode: 'KYB_COMPLETE',
        subject: { unn: SUBJECT_ID, manager: { id: '1098765432', id_type: 'NATIONAL_ID' } },
        subjectIdentifiers: [{ idType: 'UNN', value: SUBJECT_ID }],
        triggeredBy: 'API',
        modeAtExecution: 'BYOC',
        runStep: fixture.runnerFor(tx),
        keys,
      }),
    );

    const queued = await pending();
    expect(queued.length).toBeGreaterThan(0);
    const message = queued[0];
    expect(message?.address).toBe('compliance@client.example.sa');
    expect(message?.eventType).toBe('verification.completed');
    // Rule 4 and rule 5, checked on the stored row rather than only on the template.
    expect(JSON.stringify(queued)).not.toContain(SUBJECT_ID);
    expect(JSON.stringify(queued)).not.toContain(PROVIDER_NAME);
  });

  it('sends nothing to an address nobody proved', async () => {
    const unproved = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const id = await addChannel(tx, { address: 'stranger@example.com' });
      await subscribe(tx, { channelId: id, eventType: 'wallet.low' });
      const queued = await queueNotifications(tx, {
        eventType: 'wallet.low',
        consoleUrl: 'https://console.nx.sa',
      });
      return queued;
    });

    // Otherwise a rule pointing at a stranger's inbox makes this platform a way to send
    // that stranger mail.
    expect(unproved).toEqual([]);

    const proved = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const channels = await listChannels(tx);
      const stranger = channels.find((channel) => channel.address === 'stranger@example.com');
      expect(stranger?.verified).toBe(false);
      await verifyChannel(tx, stranger?.id ?? '');
      return queueNotifications(tx, {
        eventType: 'wallet.low',
        consoleUrl: 'https://console.nx.sa',
      });
    });
    expect(proved.length).toBe(1);
  });

  it('respects a subscription that only wants the serious ones', async () => {
    const queued = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const id = await addChannel(tx, { address: 'ceo@client.example.sa', verified: true });
      await subscribe(tx, {
        channelId: id,
        eventType: 'verification.completed',
        minSeverity: 'CRITICAL',
      });
      await subscribe(tx, { channelId: id, eventType: 'wallet.low', minSeverity: 'CRITICAL' });

      const completed = await queueNotifications(tx, {
        eventType: 'verification.completed',
        consoleUrl: 'https://console.nx.sa',
      });
      const wallet = await queueNotifications(tx, {
        eventType: 'wallet.low',
        consoleUrl: 'https://console.nx.sa',
      });
      return { completed, wallet };
    });

    // A completed verification is routine. A balance that will stop the platform is not.
    const toCeo = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ count: string }>(
        `SELECT count(*) FROM notification_deliveries d
         JOIN notification_channels c ON c.id = d.channel_id
         WHERE c.address = 'ceo@client.example.sa' AND d.event_type = 'verification.completed'`,
      ),
    );
    expect(toCeo.rows[0]?.count).toBe('0');
    expect(queued.wallet.length).toBeGreaterThan(0);
  });

  it('sends the queued messages and marks them sent', async () => {
    const transport = new CollectingMailTransport();
    const summaries = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      deliverNotifications(tx, { transport }),
    );

    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.every((summary) => summary.ok)).toBe(true);
    expect(transport.sent.length).toBe(summaries.length);
    expect(transport.sent[0]?.subject).toBeTruthy();

    // Nothing is left to send, and nothing was sent twice.
    expect(await pending()).toEqual([]);
  });

  it('keeps a refused message for another attempt, and gives up in the end', async () => {
    const refusing: MailTransport = {
      send: () => Promise.resolve({ ok: false, error: 'mailbox unavailable' }),
    };

    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      queueNotifications(tx, { eventType: 'entity.changed', consoleUrl: 'https://console.nx.sa' }),
    );

    let attempts = 0;
    for (let round = 0; round < 8; round += 1) {
      const summaries = await withTenant(db.appPool, tenant.tenantId, async (tx) => {
        // The backoff is real time, so the test moves the clock on the row instead of
        // waiting for it.
        await tx.query(
          `UPDATE notification_deliveries SET next_retry_at = now() - interval '1 minute'
           WHERE tenant_id = $1 AND status = 'pending'`,
          [tx.tenantId],
        );
        return deliverNotifications(tx, { transport: refusing });
      });
      attempts += summaries.length;
      if (summaries.length === 0) {
        break;
      }
    }

    expect(attempts).toBeGreaterThan(1);
    const abandoned = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      tx.query<{ status: string; last_error: string }>(
        `SELECT status, last_error FROM notification_deliveries
         WHERE tenant_id = $1 AND event_type = 'entity.changed'
         ORDER BY created_at DESC LIMIT 1`,
        [tx.tenantId],
      ),
    );
    expect(abandoned.rows[0]?.status).toBe('abandoned');
    expect(abandoned.rows[0]?.last_error).toContain('mailbox unavailable');
  });

  it('stops sending to a channel once its subscription is off', async () => {
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM notification_rules
         WHERE tenant_id = $1 AND channel_id = $2 AND event_type = 'entity.changed'`,
        [tx.tenantId, channelId],
      );
      await unsubscribe(tx, rows[0]?.id ?? '');
    });

    const queued = await withTenant(db.appPool, tenant.tenantId, (tx) =>
      queueNotifications(tx, { eventType: 'entity.changed', consoleUrl: 'https://console.nx.sa' }),
    );
    expect(queued).toEqual([]);
  });
});
