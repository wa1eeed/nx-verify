import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';

/**
 * API key issuance and authentication.
 *
 * The key exists in full exactly once, in the response that creates it. What is stored is
 * a SHA-256 hash and a short prefix, so a stolen database yields no working key and a
 * leaked log line yields at most a prefix.
 *
 * The hash here is plain SHA-256 rather than a slow password hash on purpose. The key is
 * 256 bits of randomness we generated, so there is nothing to brute force and no work
 * factor to add. A slow hash on the authentication path would only add latency to every
 * request.
 */

const KEY_BYTES = 32;
const PREFIX_LENGTH = 12;

export interface IssuedKey {
  id: string;
  /** The full key. Returned once and never recoverable. */
  secret: string;
  prefix: string;
  environment: 'sandbox' | 'live';
}

export interface IssueKeyInput {
  name: string;
  environment?: 'sandbox' | 'live';
  scopes?: string[];
}

export function hashApiKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export async function issueApiKey(tx: TenantTransaction, input: IssueKeyInput): Promise<IssuedKey> {
  const environment = input.environment ?? 'sandbox';
  // The prefix is part of the key, so a customer can match a console row to a key they
  // hold without either of us handling the whole value.
  const secret = `nx_${environment === 'live' ? 'live' : 'test'}_${randomBytes(KEY_BYTES).toString('base64url')}`;
  const prefix = secret.slice(0, PREFIX_LENGTH);

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, scopes, environment)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      tx.tenantId,
      input.name,
      prefix,
      hashApiKey(secret),
      input.scopes ?? ['verifications:write'],
      environment,
    ],
  );

  const id = rows[0]?.id;
  if (!id) {
    throw new NxError('NX-5001', { detail: 'api key insert returned no id' });
  }
  return { id, secret, prefix, environment };
}

export interface AuthenticatedCaller {
  tenantId: string;
  apiKeyId: string;
  scopes: string[];
  environment: 'sandbox' | 'live';
}

/**
 * Resolves a presented key to a tenant.
 *
 * This is the one lookup that cannot be tenant scoped, since the tenant is what it
 * determines. It runs through a single security definer function that accepts a hash and
 * returns nothing but an identity, so the widest privilege in the system is also its
 * narrowest surface.
 */
export async function authenticate(
  db: Queryable,
  presentedKey: string,
): Promise<AuthenticatedCaller> {
  if (!presentedKey.startsWith('nx_')) {
    throw new NxError('NX-4011');
  }

  const { rows } = await db.query<{
    tenant_id: string;
    api_key_id: string;
    scopes: string[];
    environment: 'sandbox' | 'live';
  }>('SELECT tenant_id, api_key_id, scopes, environment FROM app.resolve_api_key($1)', [
    hashApiKey(presentedKey),
  ]);

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4011');
  }

  return {
    tenantId: row.tenant_id,
    apiKeyId: row.api_key_id,
    scopes: row.scopes,
    environment: row.environment,
  };
}

export function assertScope(caller: AuthenticatedCaller, scope: string): void {
  if (!caller.scopes.includes(scope)) {
    throw new NxError('NX-4031', { detail: `this key does not carry the ${scope} scope` });
  }
}

export async function revokeApiKey(tx: TenantTransaction, keyId: string): Promise<void> {
  await tx.query(
    `UPDATE api_keys SET revoked_at = now() WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL`,
    [tx.tenantId, keyId],
  );
}

export async function touchApiKey(tx: TenantTransaction, keyId: string): Promise<void> {
  await tx.query(`UPDATE api_keys SET last_used_at = now() WHERE tenant_id = $1 AND id = $2`, [
    tx.tenantId,
    keyId,
  ]);
}

/** Constant time comparison, for anywhere a key or signature is compared directly. */
export function secureEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ApiKeySummary {
  id: string;
  name: string;
  /** Shown in the console and safe in a log. Never enough to authenticate. */
  keyPrefix: string;
  scopes: string[];
  environment: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * The keys a workspace has.
 *
 * The secret is not here and cannot be: the table holds a hash. What a screen shows is
 * the prefix, which is what a customer matches against their own configuration, and what
 * a support conversation can safely quote.
 */
export async function listApiKeys(tx: TenantTransaction): Promise<ApiKeySummary[]> {
  const { rows } = await tx.query<{
    id: string;
    name: string;
    key_prefix: string;
    scopes: string[];
    environment: string;
    created_at: Date;
    last_used_at: Date | null;
    revoked_at: Date | null;
  }>(
    `SELECT id, name, key_prefix, scopes, environment, created_at, last_used_at, revoked_at
     FROM api_keys
     WHERE tenant_id = $1
     ORDER BY revoked_at NULLS FIRST, created_at DESC`,
    [tx.tenantId],
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    environment: row.environment,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}
