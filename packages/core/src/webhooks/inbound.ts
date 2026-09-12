import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Queryable } from '@nx-verify/db';
import { NxError } from '../errors.js';

/**
 * Calls that arrive from a provider rather than going to one.
 *
 * An open banking provider finishes refreshing an entity on its own schedule and then
 * calls us. Without somewhere for that call to land, the services that depend on it
 * cannot be offered at all, however complete the outbound adapter is.
 *
 * Two things this module refuses to do. It does not trust an unsigned body, and it does
 * not keep one: the signature is checked against material in the secret store, and what
 * is written down is the digest of the bytes that were checked rather than the bytes. A
 * provider payload carries account numbers and names, and rule 4 does not stop applying
 * because someone else sent them to us.
 */

export interface CallbackTarget {
  provider: string;
  environment: 'sandbox' | 'live';
  secretRef: string;
  header: string;
  algorithm: 'sha256' | 'sha512';
}

/**
 * Finds the connection a callback path belongs to.
 *
 * The slug is opaque and carries no provider name, because the path is a public surface
 * and rule 5 does not care that the caller is the provider itself.
 */
export async function resolveCallback(db: Queryable, slug: string): Promise<CallbackTarget | null> {
  const { rows } = await db.query<{
    provider: string;
    environment: 'sandbox' | 'live';
    callback_secret_ref: string;
    callback_header: string;
    callback_algorithm: 'sha256' | 'sha512';
  }>(
    `SELECT provider, environment, callback_secret_ref, callback_header, callback_algorithm
     FROM provider_connections
     WHERE callback_slug = $1 AND status = 'active'`,
    [slug],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    provider: row.provider,
    environment: row.environment,
    secretRef: row.callback_secret_ref,
    header: row.callback_header,
    algorithm: row.callback_algorithm,
  };
}

/** A slug long enough that finding one by guessing is not a strategy. */
export function newCallbackSlug(): string {
  return randomBytes(24).toString('base64url');
}

export function digestOf(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Checks a provider's signature over the exact bytes that arrived.
 *
 * The raw buffer, never a re-serialised object: two JSON documents can mean the same
 * thing and hash differently, and a verifier that re-serialises is a verifier that fails
 * on whitespace and passes on nothing useful.
 *
 * The header value may be bare hex or carry an algorithm prefix, because providers
 * disagree about that and both forms say the same thing.
 */
export function verifyProviderSignature(
  secret: string,
  body: Buffer,
  presented: string,
  algorithm: 'sha256' | 'sha512',
): boolean {
  const separator = presented.indexOf('=');
  const provided = separator === -1 ? presented.trim() : presented.slice(separator + 1).trim();
  if (provided.length === 0) {
    return false;
  }

  const expected = createHmac(algorithm, secret).update(body).digest('hex');
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(provided.toLowerCase(), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface InboundEvent {
  id: string;
  provider: string;
  environment: string;
  eventType: string;
  externalId: string;
  status: string;
  receivedAt: Date;
}

export interface RecordInboundInput {
  target: CallbackTarget;
  body: Buffer;
  parsed: unknown;
}

export interface RecordInboundResult {
  id: string;
  duplicate: boolean;
}

/**
 * Writes the delivery down, once.
 *
 * A provider that does not hear a prompt answer retries, and it is entitled to: the
 * second delivery is the same event and must not become a second piece of work. The
 * provider's own id is what makes that true, and where a provider sends none the digest
 * of the body serves, so a byte identical retry is still recognised.
 */
export async function recordInboundEvent(
  db: Queryable,
  input: RecordInboundInput,
): Promise<RecordInboundResult> {
  const digest = digestOf(input.body);
  const envelope = asRecord(input.parsed);

  const externalId = firstString(envelope, ['id', 'event_id', 'eventId', 'message_id']) ?? digest;
  const eventType = firstString(envelope, ['type', 'event_type', 'eventType', 'event']) ?? 'unknown';

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO inbound_events (provider, environment, event_type, external_id, body_digest)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (provider, environment, external_id) DO NOTHING
     RETURNING id`,
    [input.target.provider, input.target.environment, eventType, externalId, digest],
  );

  const inserted = rows[0];
  if (inserted) {
    return { id: inserted.id, duplicate: false };
  }

  const existing = await db.query<{ id: string }>(
    `SELECT id FROM inbound_events
     WHERE provider = $1 AND environment = $2 AND external_id = $3`,
    [input.target.provider, input.target.environment, externalId],
  );
  const row = existing.rows[0];
  if (!row) {
    throw new NxError('NX-5001', { detail: 'the delivery could not be written down' });
  }
  return { id: row.id, duplicate: true };
}

export interface SetCallbackInput {
  provider: string;
  environment: 'sandbox' | 'live';
  /** A pointer into the secret store, never the secret (rule 10). */
  secretRef: string;
  header?: string;
  algorithm?: 'sha256' | 'sha512';
  /** Issues a new address and retires the old one. */
  rotate?: boolean;
}

/**
 * Turns a callback on for one provider in one environment, and hands back the address.
 *
 * The slug is kept once issued, because it is pasted into a provider's dashboard and
 * changing it silently would stop deliveries with nothing to show why. Rotation is asked
 * for explicitly.
 *
 * Runs on the operator connection: a callback address is our configuration and crosses
 * every subscriber, so no tenant role may write it.
 */
export async function setCallback(
  operator: Queryable,
  input: SetCallbackInput,
): Promise<{ slug: string }> {
  if (!input.secretRef.startsWith('kms://')) {
    throw new NxError('NX-4001', {
      detail: 'a callback secret is a kms:// reference, not the secret itself',
    });
  }

  const { rows } = await operator.query<{ callback_slug: string }>(
    `UPDATE provider_connections
     SET callback_slug = CASE
           WHEN $5 OR callback_slug IS NULL THEN $6
           ELSE callback_slug
         END,
         callback_secret_ref = $3,
         callback_header = $4,
         callback_algorithm = $7,
         updated_at = now()
     WHERE provider = $1 AND environment = $2
     RETURNING callback_slug`,
    [
      input.provider,
      input.environment,
      input.secretRef,
      (input.header ?? 'x-nx-provider-signature').toLowerCase(),
      input.rotate ?? false,
      newCallbackSlug(),
      input.algorithm ?? 'sha256',
    ],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', {
      detail: 'there is no connection for that provider in that environment',
    });
  }
  return { slug: row.callback_slug };
}

export async function listInboundEvents(db: Queryable, limit = 50): Promise<InboundEvent[]> {
  const { rows } = await db.query<{
    id: string;
    provider: string;
    environment: string;
    event_type: string;
    external_id: string;
    status: string;
    received_at: Date;
  }>(
    `SELECT id, provider, environment, event_type, external_id, status, received_at
     FROM inbound_events
     ORDER BY received_at DESC
     LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    environment: row.environment,
    eventType: row.event_type,
    externalId: row.external_id,
    status: row.status,
    receivedAt: row.received_at,
  }));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0 && value.length <= 200) {
      return value;
    }
  }
  return null;
}
