import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../packages/db/src/client.js';
import {
  MAX_PROOF_ATTEMPTS,
  proveChannel,
  removeChannel,
  startChannelProof,
} from '../src/notifications/channel-proof.js';
import {
  addChannel,
  listChannels,
  queueNotifications,
  subscribe,
} from '../src/notifications/notifications.js';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db.js';

/**
 * Proving that a notification address belongs to whoever typed it (ADR-145).
 *
 * The property this file exists for is the one that was missing entirely: an address that
 * nobody proved receives nothing, and until now there was no way to prove one, so the queue's
 * gate was shut for every subscriber. The rest is the same discipline as a sign in code: the
 * digits are never stored, five guesses spend it, and every refusal is the same refusal.
 */

describe('proving a notification address', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  const inTenant = <T>(work: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(db.appPool, tenant.tenantId, work);

  /** A fresh address waiting to be proved, with its code in hand. */
  const pending = async (address: string) => {
    const channelId = await inTenant((tx) => addChannel(tx, { address }));
    const issued = await inTenant((tx) => startChannelProof(tx, channelId));
    return { channelId, ...issued };
  };

  /** Asking again inside a minute is refused, so tests that resend clear the clock. */
  const forgetTheMinute = (channelId: string) =>
    inTenant((tx) =>
      tx.query(
        `UPDATE notification_channels SET proof_sent_at = now() - interval '5 minutes'
          WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, channelId],
      ),
    );

  /**
   * One round of the queue, and what it put in front of this address.
   *
   * Counted per address rather than in total, because these tests share a workspace and an
   * earlier one leaves a proved address subscribed behind it.
   */
  const queuedFor = async (channelId: string): Promise<number> => {
    await inTenant((tx) =>
      queueNotifications(tx, { eventType: 'entity.changed', consoleUrl: 'https://c.example' }),
    );
    const { rows } = await inTenant((tx) =>
      tx.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notification_deliveries
          WHERE tenant_id = $1 AND channel_id = $2`,
        [tx.tenantId, channelId],
      ),
    );
    return Number(rows[0]?.count ?? '0');
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'Proof Tenant');
  });

  afterAll(async () => {
    await db.close();
  });

  it('stores no part of the code anybody could read back', async () => {
    const { channelId, code } = await pending('ops@acme.sa');
    const { rows } = await inTenant((tx) =>
      tx.query<{ hash: Buffer }>(
        `SELECT proof_hash AS hash FROM notification_channels WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, channelId],
      ),
    );
    expect(JSON.stringify(rows[0])).not.toContain(code);
    expect(rows[0]?.hash.length).toBe(32);
  });

  it('proves the address with the right code, once', async () => {
    const { channelId, code } = await pending('once@acme.sa');
    await inTenant((tx) => proveChannel(tx, { channelId, code }));

    const channel = (await inTenant(listChannels)).find((c) => c.id === channelId);
    expect(channel?.verified).toBe(true);
    // And the proof is gone with it: a proved address holding a live code is a second way
    // into something already settled.
    expect(channel?.awaitingProof).toBe(false);
    await expect(inTenant((tx) => proveChannel(tx, { channelId, code }))).rejects.toMatchObject({
      code: 'NX-4011',
    });
  });

  it('gives the same answer to a wrong code and to an address that is not waiting', async () => {
    const { channelId, code } = await pending('same@acme.sa');
    const other = await inTenant((tx) => addChannel(tx, { address: 'noproof@acme.sa' }));

    const wrong = await inTenant((tx) =>
      proveChannel(tx, { channelId, code: '000000' }).catch((error) => error),
    );
    const notWaiting = await inTenant((tx) =>
      proveChannel(tx, { channelId: other, code }).catch((error) => error),
    );
    expect(wrong.code).toBe('NX-4011');
    expect(notWaiting.code).toBe('NX-4011');
    expect(wrong.message).toBe(notWaiting.message);
  });

  it('dies after five guesses, even with the right code afterwards', async () => {
    const { channelId, code } = await pending('guess@acme.sa');
    for (let attempt = 0; attempt < MAX_PROOF_ATTEMPTS; attempt += 1) {
      await inTenant((tx) => proveChannel(tx, { channelId, code: '111111' }).catch(() => null));
    }
    await expect(inTenant((tx) => proveChannel(tx, { channelId, code }))).rejects.toMatchObject({
      code: 'NX-4011',
    });
  });

  it('gives back the guesses when a new code is asked for, and kills the old one', async () => {
    const { channelId, code: first } = await pending('again@acme.sa');
    await inTenant((tx) => proveChannel(tx, { channelId, code: '222222' }).catch(() => null));
    await forgetTheMinute(channelId);

    const second = await inTenant((tx) => startChannelProof(tx, channelId));
    expect(second.code).not.toBe(first);
    // The person asking again is the person who owns the mailbox; a stale code nobody holds
    // is not what should have spent their attempts.
    await expect(
      inTenant((tx) => proveChannel(tx, { channelId, code: first })),
    ).rejects.toMatchObject({ code: 'NX-4011' });
    await inTenant((tx) => proveChannel(tx, { channelId, code: second.code }));
    expect((await inTenant(listChannels)).find((c) => c.id === channelId)?.verified).toBe(true);
  });

  it('expires, so a code read off an old message proves nothing', async () => {
    const { channelId, code } = await pending('old@acme.sa');
    await inTenant((tx) =>
      tx.query(
        `UPDATE notification_channels SET proof_expires_at = now() - interval '1 minute'
          WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, channelId],
      ),
    );
    await expect(inTenant((tx) => proveChannel(tx, { channelId, code }))).rejects.toMatchObject({
      code: 'NX-4011',
    });
  });

  it('refuses a second code inside a minute, so a button is not a way to mail a stranger', async () => {
    const { channelId } = await pending('flood@acme.sa');
    await expect(inTenant((tx) => startChannelProof(tx, channelId))).rejects.toMatchObject({
      code: 'NX-4029',
    });
  });

  it('refuses to start a proof for an address that is already proved', async () => {
    const { channelId, code } = await pending('done@acme.sa');
    await inTenant((tx) => proveChannel(tx, { channelId, code }));
    await expect(inTenant((tx) => startChannelProof(tx, channelId))).rejects.toMatchObject({
      code: 'NX-4041',
    });
  });

  it('delivers nothing to an address until it is proved, and everything after', async () => {
    const { channelId, code } = await pending('queue@acme.sa');
    await inTenant((tx) => subscribe(tx, { channelId, eventType: 'entity.changed' }));

    expect(await queuedFor(channelId)).toBe(0);

    await inTenant((tx) => proveChannel(tx, { channelId, code }));
    expect(await queuedFor(channelId)).toBe(1);
  });

  it('removes an address and stops what was going to it', async () => {
    const { channelId, code } = await pending('leaver@acme.sa');
    await inTenant((tx) => proveChannel(tx, { channelId, code }));
    await inTenant((tx) => subscribe(tx, { channelId, eventType: 'entity.changed' }));
    await inTenant((tx) => removeChannel(tx, channelId));

    expect(await queuedFor(channelId)).toBe(0);
  });

  it('lets a removed address be added again, rather than refusing it forever', async () => {
    const { channelId, code } = await pending('back@acme.sa');
    await inTenant((tx) => proveChannel(tx, { channelId, code }));
    await inTenant((tx) => removeChannel(tx, channelId));

    const revived = await inTenant((tx) => addChannel(tx, { address: 'back@acme.sa' }));
    expect(revived).toBe(channelId);
    // And it comes back unproved: removing it gave up the proof, and the mailbox gets to
    // say so again.
    expect((await inTenant(listChannels)).find((c) => c.id === channelId)?.verified).toBe(false);
  });

  it('still refuses a second row for an address that is live', async () => {
    await inTenant((tx) => addChannel(tx, { address: 'twice@acme.sa' }));
    await expect(
      inTenant((tx) => addChannel(tx, { address: 'twice@acme.sa' })),
    ).rejects.toMatchObject({ code: 'NX-4091' });
  });
});
