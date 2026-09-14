import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../test/helpers/db.js';
import {
  digestOf,
  listInboundEvents,
  recordInboundEvent,
  resolveCallback,
  setCallback,
  verifyProviderSignature,
} from '../src/webhooks/inbound.js';

/**
 * Unit 60 acceptance: a provider can call us, and only a provider can.
 *
 * The signature is the whole of the authentication on this path, so the tests that matter
 * are the ones that try to get past it: a wrong secret, a changed body, a missing header.
 * The other half is that a retry is the same event, because a provider that does not hear
 * a prompt answer will send one.
 */

const SECRET = 'a-shared-webhook-secret';

describe('inbound provider callbacks', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.operatorPool.query(
      `INSERT INTO provider_catalog (code, name_ar, name_en, endpoints)
       VALUES ('openbank', 'مصرفي مفتوح', 'Open bank', '{iban_ownership}')
       ON CONFLICT (code) DO NOTHING`,
    );
    await db.operatorPool.query(
      `INSERT INTO provider_connections (provider, environment, kind, base_url, auth_url)
       VALUES ('openbank', 'sandbox', 'openbanking', 'https://api.example.com',
               'https://auth.example.com/oauth2/token')
       ON CONFLICT (provider, environment) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('refuses to store the secret itself in place of a reference', async () => {
    await expect(
      setCallback(db.operatorPool, {
        provider: 'openbank',
        environment: 'sandbox',
        secretRef: SECRET,
      }),
    ).rejects.toMatchObject({ code: 'NX-4001' });
  });

  it('issues an address that carries no provider name, and keeps it', async () => {
    const first = await setCallback(db.operatorPool, {
      provider: 'openbank',
      environment: 'sandbox',
      secretRef: 'kms://providers/openbank/webhook',
      header: 'lean-signature',
      algorithm: 'sha512',
    });

    expect(first.slug).not.toContain('openbank');
    expect(first.slug.length).toBeGreaterThan(20);

    // Saving again must not change the address: it has been pasted into a supplier's
    // dashboard by then, and a silent change stops deliveries with nothing to show why.
    const again = await setCallback(db.operatorPool, {
      provider: 'openbank',
      environment: 'sandbox',
      secretRef: 'kms://providers/openbank/webhook',
    });
    expect(again.slug).toBe(first.slug);

    const rotated = await setCallback(db.operatorPool, {
      provider: 'openbank',
      environment: 'sandbox',
      secretRef: 'kms://providers/openbank/webhook',
      rotate: true,
    });
    expect(rotated.slug).not.toBe(first.slug);

    // The retired address resolves to nothing, which is what retiring one means.
    const stale = await resolveCallback(db.operatorPool, first.slug);
    expect(stale).toBeNull();
  });

  it('resolves an address to one provider in one environment', async () => {
    const { slug } = await setCallback(db.operatorPool, {
      provider: 'openbank',
      environment: 'sandbox',
      secretRef: 'kms://providers/openbank/webhook',
      header: 'lean-signature',
      algorithm: 'sha512',
      rotate: true,
    });

    const target = await resolveCallback(db.operatorPool, slug);
    expect(target).toMatchObject({
      provider: 'openbank',
      environment: 'sandbox',
      secretRef: 'kms://providers/openbank/webhook',
      header: 'lean-signature',
      algorithm: 'sha512',
    });
  });

  it('accepts the provider signature over the exact bytes and nothing else', () => {
    const body = Buffer.from('{"id":"evt_1","type":"entity.data.refresh.updated"}', 'utf8');
    const signature = createHmac('sha512', SECRET).update(body).digest('hex');

    expect(verifyProviderSignature(SECRET, body, `sha512=${signature}`, 'sha512')).toBe(true);
    // Bare hex says the same thing, and providers disagree about the prefix.
    expect(verifyProviderSignature(SECRET, body, signature, 'sha512')).toBe(true);

    // A body that means the same and is not the same bytes. This is exactly why the raw
    // buffer is signed rather than a re-serialised object.
    const respaced = Buffer.from('{"id": "evt_1", "type": "entity.data.refresh.updated"}', 'utf8');
    expect(verifyProviderSignature(SECRET, respaced, `sha512=${signature}`, 'sha512')).toBe(false);

    expect(verifyProviderSignature('another-secret', body, `sha512=${signature}`, 'sha512')).toBe(
      false,
    );
    expect(verifyProviderSignature(SECRET, body, '', 'sha512')).toBe(false);
    expect(verifyProviderSignature(SECRET, body, `sha512=${signature}`, 'sha256')).toBe(false);
  });

  it('treats a redelivery as the same event', async () => {
    const target = {
      provider: 'openbank',
      environment: 'sandbox' as const,
      secretRef: 'kms://providers/openbank/webhook',
      header: 'lean-signature',
      algorithm: 'sha512' as const,
    };
    const body = Buffer.from('{"id":"evt_replay","type":"entity.data.refresh.updated"}', 'utf8');

    const first = await recordInboundEvent(db.appPool, {
      target,
      body,
      parsed: JSON.parse(body.toString()),
    });
    const second = await recordInboundEvent(db.appPool, {
      target,
      body,
      parsed: JSON.parse(body.toString()),
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('recognises a retry from a provider that sends no event id', async () => {
    const target = {
      provider: 'openbank',
      environment: 'sandbox' as const,
      secretRef: 'kms://providers/openbank/webhook',
      header: 'lean-signature',
      algorithm: 'sha512' as const,
    };
    const body = Buffer.from('{"type":"entity.data.refresh.updated"}', 'utf8');

    const first = await recordInboundEvent(db.appPool, { target, body, parsed: { type: 'x' } });
    const second = await recordInboundEvent(db.appPool, { target, body, parsed: { type: 'x' } });
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('writes down the digest and never the body', async () => {
    const target = {
      provider: 'openbank',
      environment: 'sandbox' as const,
      secretRef: 'kms://providers/openbank/webhook',
      header: 'lean-signature',
      algorithm: 'sha512' as const,
    };
    // A payload shaped like the ones that actually arrive: an identifier and an account
    // number, neither of which may end up in a column or a backup (rule 4).
    const body = Buffer.from(
      '{"id":"evt_pii","type":"entity.updated","national_id":"1098765432",' +
        '"iban":"SA4420000001234567891234"}',
      'utf8',
    );
    await recordInboundEvent(db.appPool, { target, body, parsed: JSON.parse(body.toString()) });

    const { rows } = await db.migratorPool.query<{ hit: string }>(
      `SELECT count(*)::text AS hit FROM inbound_events
       WHERE external_id LIKE '%1098765432%' OR external_id LIKE '%SA44200000%'
          OR event_type LIKE '%1098765432%' OR body_digest LIKE '%SA44200000%'`,
    );
    expect(rows[0]?.hit).toBe('0');

    const events = await listInboundEvents(db.appPool);
    const stored = events.find((event) => event.externalId === 'evt_pii');
    expect(stored?.eventType).toBe('entity.updated');
    // The digest proves which bytes were verified without keeping them.
    const { rows: digestRows } = await db.migratorPool.query<{ body_digest: string }>(
      `SELECT body_digest FROM inbound_events WHERE external_id = 'evt_pii'`,
    );
    expect(digestRows[0]?.body_digest).toBe(digestOf(body));
  });
});
