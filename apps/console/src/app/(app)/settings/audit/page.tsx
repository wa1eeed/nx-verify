import type { ReactElement } from 'react';
import { NoAccess } from '../../../../components/no-access';
import { readAudit } from '@nx-verify/core';
import { AuditTrail, type AuditRowView } from '../../../../components/audit-trail';
import { actingUser, query } from '../../../../lib/context';
import { SectionTabs } from '../../../../components/section-tabs';
import { SETTINGS_TABS, visible } from '../../../../components/nav';

/** Never prerendered: one workspace's own trail, read at request time. */
export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; from?: string; to?: string; before?: string }>;
}): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('audit.read')) {
    return <NoAccess needs="audit.read" />;
  }
  const { action, from, to, before } = await searchParams;

  /*
   * A window, because a trail truncated at two hundred rows cannot answer a question about
   * last quarter and does not say that it cannot (ADR-169). One page more than asked for, so
   * the screen knows whether there is another without counting the whole table.
   */
  const PAGE = 100;
  const day = (value: string | undefined): Date | undefined =>
    value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00Z`)
      : undefined;
  // The id of the oldest row already shown, not its timestamp: rows written in one
  // transaction share a created_at, so a timestamp cursor never advanced past them.
  const cursor = before !== undefined && /^\d+$/.test(before) ? before : undefined;
  const fromDay = day(from);
  // Exclusive in the reader, so a person picking a day gets that whole day.
  const toDay = day(to);
  const toExclusive =
    toDay === undefined ? undefined : new Date(toDay.getTime() + 24 * 60 * 60 * 1000);

  const data = await query(async (tx) => {
    const page = await readAudit(tx, {
      limit: PAGE + 1,
      ...(action === undefined ? {} : { action }),
      ...(fromDay === undefined ? {} : { from: fromDay }),
      ...(toExclusive === undefined ? {} : { to: toExclusive }),
      ...(cursor === undefined ? {} : { before: cursor }),
    });
    const records = page.slice(0, PAGE);
    const more = page.length > PAGE;

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
      more,
      // The id of the oldest row shown, which is where the next page starts.
      oldest: records[records.length - 1]?.id ?? null,
    };
  });

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs tabs={visible(SETTINGS_TABS, actor.capabilities)} current="/settings/audit" label="أقسام الإعدادات" />
      <AuditTrail
        rows={data.rows}
        action={action}
        actions={data.actions}
        from={from}
        to={to}
        more={data.more}
        nextBefore={data.oldest}
      />
    </div>
  );
}
