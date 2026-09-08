import type { Queryable } from '@nx-verify/db';
import { NxError } from '../errors.js';

/**
 * Registering and retiring key versions.
 *
 * Rotation is two operator acts, not one. First the new version is registered and becomes
 * the one written with; then a job moves the stored rows across. Separating them is what
 * makes a rotation resumable, and it is also why the version column carries a foreign key:
 * a row cannot be written under a key nobody declared.
 *
 * Exactly one version is active at a time. Two would mean the same identifier could hash
 * two ways and both be inserted, which is the duplicate entity this design exists to
 * prevent.
 */

export type KeyVersionStatus = 'active' | 'retiring' | 'retired';

export interface KeyVersion {
  version: number;
  status: KeyVersionStatus;
  activatedAt: Date;
  retiredAt: Date | null;
  notes: string | null;
}

export async function listKeyVersions(db: Queryable): Promise<KeyVersion[]> {
  const { rows } = await db.query<{
    version: number;
    status: KeyVersionStatus;
    activated_at: Date;
    retired_at: Date | null;
    notes: string | null;
  }>(
    `SELECT version, status, activated_at, retired_at, notes
     FROM key_versions ORDER BY version`,
  );

  return rows.map((row) => ({
    version: row.version,
    status: row.status,
    activatedAt: row.activated_at,
    retiredAt: row.retired_at,
    notes: row.notes,
  }));
}

/**
 * Makes a new version the one written with.
 *
 * The previous active version becomes retiring: still readable, no longer written. It
 * stays that way until nothing needs it, which the rotation job and the retirement check
 * decide between them.
 */
export async function activateKeyVersion(
  db: Queryable,
  version: number,
  notes?: string,
): Promise<void> {
  if (!Number.isInteger(version) || version <= 0) {
    throw new NxError('NX-4001', { detail: 'a key version must be a positive integer' });
  }

  await db.query(`UPDATE key_versions SET status = 'retiring' WHERE status = 'active'`);
  await db.query(
    `INSERT INTO key_versions (version, status, notes)
     VALUES ($1, 'active', $2)
     ON CONFLICT (version) DO UPDATE SET status = 'active', notes = EXCLUDED.notes`,
    [version, notes ?? null],
  );
}

/**
 * Discards a version.
 *
 * The caller must have established that nothing still reads it. The check lives in the
 * worker, because it has to count rows across identifiers and evidence, and retiring a
 * version that still signs a customer's audit document would silently make that document
 * uncheckable.
 */
export async function retireKeyVersion(db: Queryable, version: number): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE key_versions
     SET status = 'retired', retired_at = now()
     WHERE version = $1 AND status = 'retiring'`,
    [version],
  );

  if (rowCount === 0) {
    throw new NxError('NX-4002', {
      detail: 'only a retiring version can be retired, and the active one never can',
    });
  }
}
