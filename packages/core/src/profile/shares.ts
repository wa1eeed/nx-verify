import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Queryable, TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { FIELD_GROUP_ORDER, type FieldGroup } from './field-catalogue.js';

/**
 * A verified profile a third party can open.
 *
 * The file is worth something outside the subscriber's own screen. A bank opening an
 * account for a merchant, a marketplace listing a seller, a financier looking at a
 * contractor: today each of them is sent a folder of scans, and a scan proves nothing
 * about when it was true.
 *
 * What makes it safe to publish is what this module refuses to do.
 *
 * It never stores the token. The link is shown once, at issue, and the row holds a hash:
 * a table of live links is readable by everyone who can read the table.
 *
 * It never opens more than was chosen. A share names the groups it opens, and a group the
 * sharer did not pick is not fetched rather than fetched and hidden.
 *
 * And it always ends. An expiry is required by the column, not by the caller remembering,
 * because a link with no end is a disclosure with a delay.
 */

/** Long enough that guessing is not a strategy, short enough to paste in a message. */
const TOKEN_BYTES = 24;
const MAX_TTL_DAYS = 180;

export function hashShareToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export interface CreateShareInput {
  entityId: string;
  /** Which groups of facts the recipient may see. At least one. */
  groups: FieldGroup[];
  /** Why it was shared, for the subscriber's own record. Never shown to the recipient. */
  purpose?: string | null;
  ttlDays: number;
  createdBy?: string | null;
}

export interface CreatedShare {
  shareId: string;
  /** Shown once. Never readable again, from here or from the database. */
  token: string;
  expiresAt: Date;
}

export async function createShare(
  tx: TenantTransaction,
  input: CreateShareInput,
): Promise<CreatedShare> {
  const groups = input.groups.filter((group) => FIELD_GROUP_ORDER.includes(group));
  if (groups.length === 0) {
    throw new NxError('NX-4001', {
      detail: 'a share must open at least one group of facts',
    });
  }
  if (!Number.isInteger(input.ttlDays) || input.ttlDays < 1 || input.ttlDays > MAX_TTL_DAYS) {
    throw new NxError('NX-4001', {
      detail: `a share lasts between 1 and ${MAX_TTL_DAYS} days`,
    });
  }

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO profile_shares (tenant_id, entity_id, token_hash, groups, purpose,
                                 created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      tx.tenantId,
      input.entityId,
      hashShareToken(token),
      groups,
      input.purpose ?? null,
      input.createdBy ?? null,
      expiresAt,
    ],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-5001', { detail: 'the share could not be created' });
  }

  return { shareId: row.id, token, expiresAt };
}

export async function revokeShare(tx: TenantTransaction, shareId: string): Promise<void> {
  await tx.query(
    `UPDATE profile_shares SET revoked_at = now()
     WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL`,
    [tx.tenantId, shareId],
  );
}

export interface ShareRow {
  shareId: string;
  entityId: string;
  groups: string[];
  purpose: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  viewCount: number;
  lastViewedAt: Date | null;
  /** Live, expired or revoked. Worked out here so no screen has to invent the rule. */
  state: 'live' | 'expired' | 'revoked';
}

export async function listShares(
  tx: TenantTransaction,
  entityId: string,
  now = new Date(),
): Promise<ShareRow[]> {
  const { rows } = await tx.query<{
    id: string;
    entity_id: string;
    groups: string[];
    purpose: string | null;
    created_at: Date;
    expires_at: Date;
    revoked_at: Date | null;
    view_count: number;
    last_viewed_at: Date | null;
  }>(
    `SELECT id, entity_id, groups, purpose, created_at, expires_at, revoked_at,
            view_count, last_viewed_at
     FROM profile_shares
     WHERE tenant_id = $1 AND entity_id = $2
     ORDER BY created_at DESC`,
    [tx.tenantId, entityId],
  );

  return rows.map((row) => ({
    shareId: row.id,
    entityId: row.entity_id,
    groups: row.groups,
    purpose: row.purpose,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    viewCount: row.view_count,
    lastViewedAt: row.last_viewed_at,
    state: row.revoked_at !== null ? 'revoked' : row.expires_at <= now ? 'expired' : 'live',
  }));
}

export interface ResolvedShare {
  shareId: string;
  tenantId: string;
  entityId: string;
  groups: string[];
}

/**
 * Turns a link into the workspace and entity it opens.
 *
 * Runs without a tenant in scope, because the caller has no account: this is the same
 * shape as the API key lookup, and for the same reason. It refuses an expired or revoked
 * link in the database rather than in the caller, so a screen that forgets to check
 * cannot publish one.
 */
export async function resolveShare(db: Queryable, token: string): Promise<ResolvedShare | null> {
  // Compared as a hash, and the hash is what the database holds: a leaked backup opens
  // nothing.
  const hash = hashShareToken(token);
  const { rows } = await db.query<{
    share_id: string;
    tenant_id: string;
    entity_id: string;
    groups: string[];
  }>(`SELECT * FROM app.resolve_profile_share($1)`, [hash]);

  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    shareId: row.share_id,
    tenantId: row.tenant_id,
    entityId: row.entity_id,
    groups: row.groups,
  };
}

/** Counted so the sharer can see it was opened. Never who opened it, or from where. */
export async function recordShareView(tx: TenantTransaction, shareId: string): Promise<void> {
  await tx.query(
    `UPDATE profile_shares SET view_count = view_count + 1, last_viewed_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, shareId],
  );
}

/** Constant time, for a caller that compares two tokens rather than two hashes. */
export function shareTokensMatch(left: string, right: string): boolean {
  const a = hashShareToken(left);
  const b = hashShareToken(right);
  return timingSafeEqual(a, b);
}
