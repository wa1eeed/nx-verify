import type { TenantTransaction } from '@nx-verify/db';

/**
 * What is waiting for somebody's attention, in one place.
 *
 * Assembled on read from the rows that already hold these facts rather than copied into
 * an inbox table. Two copies of the same fact drift the first time one is written and the
 * other is not, and the version people see would be the stale one.
 *
 * What belongs here is what a person has to act on or decide about. A verification that
 * completed normally is not news; a verification that found something different is. The
 * test for adding a source is whether a person would want to be interrupted for it.
 */

export type InboxKind =
  | 'change'
  | 'review'
  | 'overdue'
  | 'balance'
  | 'awaiting'
  | 'share_opened';

export interface InboxItem {
  id: string;
  kind: InboxKind;
  /** What happened, in one line, with no identifier in it (rule 4). */
  titleAr: string;
  detailAr: string | null;
  at: Date;
  /** Where to go to do something about it. */
  href: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface Inbox {
  items: InboxItem[];
  /** How many arrived since this person last looked. */
  unread: number;
}

export async function listInbox(
  tx: TenantTransaction,
  options: { seenAt?: Date | null; limit?: number } = {},
): Promise<Inbox> {
  const limit = options.limit ?? 50;
  const items: InboxItem[] = [];

  const changes = await tx.query<{
    id: string;
    entity_id: string;
    field_path: string;
    severity: string;
    detected_at: Date;
  }>(
    `SELECT id, entity_id, field_path, severity, detected_at
     FROM change_events
     WHERE tenant_id = $1 AND acknowledged_at IS NULL
     ORDER BY detected_at DESC
     LIMIT $2`,
    [tx.tenantId, limit],
  );
  for (const row of changes.rows) {
    items.push({
      id: `change:${row.id}`,
      kind: 'change',
      titleAr: 'تغيّر في بيانات عميل',
      detailAr: `الحقل ${row.field_path} تغيّر منذ آخر تحقق.`,
      at: row.detected_at,
      href: `/customers/${row.entity_id}`,
      severity: row.severity === 'CRITICAL' ? 'critical' : 'warning',
    });
  }

  const cases = await tx.query<{
    id: string;
    entity_id: string | null;
    opened_at: Date;
    sla_due_at: Date | null;
    overdue: boolean;
  }>(
    `SELECT id, entity_id, opened_at, sla_due_at,
            (sla_due_at IS NOT NULL AND sla_due_at < now()) AS overdue
     FROM review_cases
     WHERE tenant_id = $1 AND closed_at IS NULL
     ORDER BY opened_at DESC
     LIMIT $2`,
    [tx.tenantId, limit],
  );
  for (const row of cases.rows) {
    items.push({
      id: `case:${row.id}`,
      kind: row.overdue ? 'overdue' : 'review',
      titleAr: row.overdue ? 'مراجعة تجاوزت مهلتها' : 'مراجعة تنتظر قراراً',
      detailAr: null,
      at: row.opened_at,
      href: '/verifications/reviews',
      severity: row.overdue ? 'critical' : 'info',
    });
  }

  const wallet = await tx.query<{ balance: string; low: boolean }>(
    `SELECT balance::text,
            (balance - held) <= (balance * low_threshold) AND balance > 0 AS low
     FROM wallets WHERE tenant_id = $1`,
    [tx.tenantId],
  );
  const walletRow = wallet.rows[0];
  if (walletRow?.low) {
    items.push({
      id: 'balance:low',
      kind: 'balance',
      titleAr: 'الرصيد منخفض',
      detailAr: 'اطلب شحناً قبل أن تتوقف عمليات التحقق.',
      at: new Date(),
      href: '/billing',
      severity: 'warning',
    });
  }

  const waits = await tx.query<{ run_id: string; created_at: Date; expires_at: Date }>(
    `SELECT run_id, created_at, expires_at FROM run_waits
     WHERE tenant_id = $1 AND status = 'WAITING'
     ORDER BY created_at DESC
     LIMIT $2`,
    [tx.tenantId, limit],
  );
  for (const row of waits.rows) {
    items.push({
      id: `wait:${row.run_id}`,
      kind: 'awaiting',
      titleAr: 'تحقق بانتظار جواب الجهة',
      detailAr: 'لا حاجة لإعادة الطلب. سنكمله حين يصل الجواب.',
      at: row.created_at,
      href: '/developers/logs',
      severity: 'info',
    });
  }

  const shares = await tx.query<{
    id: string;
    entity_id: string;
    last_viewed_at: Date;
    view_count: number;
  }>(
    `SELECT id, entity_id, last_viewed_at, view_count FROM profile_shares
     WHERE tenant_id = $1 AND last_viewed_at IS NOT NULL AND revoked_at IS NULL
     ORDER BY last_viewed_at DESC
     LIMIT $2`,
    [tx.tenantId, limit],
  );
  for (const row of shares.rows) {
    items.push({
      id: `share:${row.id}`,
      kind: 'share_opened',
      titleAr: 'فُتح ملف شاركته',
      detailAr: `عدد مرات الفتح: ${row.view_count}.`,
      at: row.last_viewed_at,
      href: `/customers/${row.entity_id}`,
      severity: 'info',
    });
  }

  items.sort((left, right) => right.at.getTime() - left.at.getTime());
  const trimmed = items.slice(0, limit);

  const seenAt = options.seenAt ?? null;
  return {
    items: trimmed,
    // Everything, not just the page shown, because a badge that counts only the first
    // fifty tells somebody with sixty problems that they have fifty.
    unread: seenAt === null ? items.length : items.filter((item) => item.at > seenAt).length,
  };
}

/** Records that this person has looked, so the badge stops counting what they have seen. */
export async function markInboxSeen(
  tx: TenantTransaction,
  userId: string,
  at = new Date(),
): Promise<void> {
  await tx.query(`UPDATE users SET notifications_seen_at = $3 WHERE tenant_id = $1 AND id = $2`, [
    tx.tenantId,
    userId,
    at,
  ]);
}

export async function inboxSeenAt(
  tx: TenantTransaction,
  userId: string,
): Promise<Date | null> {
  const { rows } = await tx.query<{ notifications_seen_at: Date | null }>(
    `SELECT notifications_seen_at FROM users WHERE tenant_id = $1 AND id = $2`,
    [tx.tenantId, userId],
  );
  return rows[0]?.notifications_seen_at ?? null;
}
