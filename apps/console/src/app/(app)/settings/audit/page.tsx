import type { ReactElement } from 'react';
import { readAudit } from '@nx-verify/core';
import { AuditTrail, type AuditRowView } from '../../../../components/audit-trail';
import { query } from '../../../../lib/context';
import { SectionTabs } from '../../../../components/section-tabs';
import { SETTINGS_TABS } from '../../../../components/nav';

/** Never prerendered: one workspace's own trail, read at request time. */
export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}): Promise<ReactElement> {
  const { action } = await searchParams;

  const data = await query(async (tx) => {
    const records = await readAudit(tx, {
      limit: 200,
      ...(action === undefined ? {} : { action }),
    });

    // Who each actor is, in words. An actor is an identity and not a string (ADR-038), so
    // the readable name is looked up rather than stored on the row: a name that changes
    // should change everywhere, and a trail is read years later.
    const userIds = [
      ...new Set(records.filter((row) => row.actorType === 'USER').map((row) => row.actorId)),
    ].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const keyIds = [
      ...new Set(records.filter((row) => row.actorType === 'API_KEY').map((row) => row.actorId)),
    ].filter((id) => /^[0-9a-f-]{36}$/i.test(id));

    const { rows: people } = userIds.length
      ? await tx.query<{ id: string; display_name: string }>(
          `SELECT id, display_name FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tx.tenantId, userIds],
        )
      : { rows: [] as { id: string; display_name: string }[] };

    const { rows: keys } = keyIds.length
      ? await tx.query<{ id: string; name: string; key_prefix: string }>(
          `SELECT id, name, key_prefix FROM api_keys WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tx.tenantId, keyIds],
        )
      : { rows: [] as { id: string; name: string; key_prefix: string }[] };

    const nameOf = new Map<string, string>([
      ...people.map((row): [string, string] => [row.id, row.display_name]),
      // The prefix, which is what support can safely quote, never the key.
      ...keys.map((row): [string, string] => [row.id, `${row.name} · ${row.key_prefix}`]),
    ]);

    // The actions this workspace's trail actually holds, so the filter offers what is there
    // rather than every action the platform could ever write.
    const { rows: kinds } = await tx.query<{ action: string }>(
      `SELECT DISTINCT action FROM audit_log WHERE tenant_id = $1 ORDER BY action`,
      [tx.tenantId],
    );

    return {
      rows: records.map((row): AuditRowView => ({
        id: row.id,
        actorType: row.actorType,
        actorId: row.actorId,
        actorName: nameOf.get(row.actorId) ?? null,
        action: row.action,
        target: row.target ?? null,
        metadata: row.metadata ?? null,
        createdAt: row.createdAt,
      })),
      actions: kinds.map((row) => row.action),
    };
  });

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={SETTINGS_TABS} current="/settings/audit" label="أقسام الإعدادات" />
      <AuditTrail rows={data.rows} action={action} actions={data.actions} />
    </div>
  );
}
