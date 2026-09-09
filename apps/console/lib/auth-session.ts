import { withTenant, withoutTenant } from '@nx-verify/db';
import { hashSessionToken, resolveSession, revokeSession } from '@nx-verify/core';
import { getPool } from './context';
import { SESSION_COOKIE } from './auth';

/**
 * Ending a session.
 *
 * Kept apart from lib/auth so that the sign in path does not import next/headers, which
 * only exists inside a request and would make that module unusable from a test.
 */
export async function revokeCurrentSession(): Promise<void> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) {
    return;
  }

  const session = await withoutTenant(getPool(), (tx) => resolveSession(tx, token));
  if (!session) {
    return;
  }

  await withTenant(getPool(), session.tenantId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM user_sessions
       WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL AND token_hash = $3`,
      [tx.tenantId, session.userId, hashSessionToken(token)],
    );
    const id = rows[0]?.id;
    if (id) {
      await revokeSession(tx, id);
    }
  });
}
