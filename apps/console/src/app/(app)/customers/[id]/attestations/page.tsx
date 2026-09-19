import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { fieldLabelAr, getAttestationTimeline } from '@nx-verify/core';
import { NoAccess } from '../../../../../components/no-access';
import { PageHeader, Panel } from '../../../../../components/page-header';
import { Timeline, type TimelineEntryView } from '../../../../../components/timeline';
import { ButtonLink, Ltr, TagLink } from '../../../../../components/ui';
import { actingUser, query } from '../../../../../lib/context';

/**
 * Everything ever recorded about one customer, newest first (docs/progress.md, the field
 * history).
 *
 * The file shows what is true now, and a field opens the values it held before. This is the
 * layer under both: every fact we ever wrote, each with the authority behind it, what set the
 * verification off, and whether a later one has replaced it. It is the answer to «ماذا كان
 * هذا الحقل يقول قبل سنة», and the reason attestations are never updated in place.
 *
 * Nothing here is an identifier: the ledger holds field values, and a customer's numbers are
 * shown on the file itself (ADR-127), never in a list that can be filtered by anybody.
 */

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The newest page of a ledger. Older rows are reached by narrowing to a field. */
const LIMIT = 200;

export default async function AttestationLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('customers.read')) {
    return <NoAccess needs="customers.read" />;
  }

  const { id } = await params;
  if (!UUID.test(id)) {
    notFound();
  }
  const search = await searchParams;
  const field = typeof search['field'] === 'string' ? search['field'] : '';

  const data = await query(async (tx) => {
    const { rows } = await tx.query<{ display_name: string | null }>(
      `SELECT display_name FROM entities WHERE tenant_id = $1 AND id = $2`,
      [tx.tenantId, id],
    );
    if (rows.length === 0) {
      return null;
    }
    const ledger = await getAttestationTimeline(tx, id, {
      ...(field === '' ? {} : { fieldPath: field }),
      limit: LIMIT,
    });
    return { name: rows[0]?.display_name ?? null, ledger };
  });

  if (data === null) {
    notFound();
  }

  const entries: TimelineEntryView[] = data.ledger.map((entry) => ({
    attestationId: entry.attestationId,
    fieldPath: entry.fieldPath,
    value: entry.value,
    // Rule 6 is a display rule too: a fact with no authority recorded says so rather than
    // appearing to come from somewhere.
    authority: entry.authority ?? 'جهة غير مسجَّلة',
    observedAt: entry.observedAt,
    triggeredBy: entry.triggeredBy,
    changed: entry.changed,
    runReference: entry.runReference,
    current: entry.supersededBy === null,
    validUntil: entry.validUntil,
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <PageHeader
        title="سجل الإفادات"
        subtitle={
          field === ''
            ? `كل ما سُجّل عن ${data.name ?? 'هذا العميل'}، الأحدث أولاً.`
            : `${fieldLabelAr(field)} · كل ما سُجّل عن هذا الحقل، الأحدث أولاً.`
        }
        action={
          <ButtonLink href={`/customers/${id}`} variant="secondary">
            عودة إلى ملف العميل
          </ButtonLink>
        }
      />

      {field === '' ? null : (
        <div className="row" style={{ gap: 'var(--s-2)', flexWrap: 'wrap' }}>
          <TagLink href={`/customers/${id}/attestations`} role="all-fields">
            كل الحقول
          </TagLink>
          <TagLink href={`/customers/${id}/attestations?field=${encodeURIComponent(field)}`} current>
            {fieldLabelAr(field)}
          </TagLink>
        </div>
      )}

      <Panel
        title="الإفادات"
        role="attestation-ledger"
        note="لا يُعدَّل سطر في هذا السجل ولا يُحذف. تحققٌ جديد يضيف سطراً ويضع علامة على السطر الذي استبدله، ولهذا يبقى للسؤال بعد سنة جواب."
        aside={
          data.ledger.length === LIMIT ? (
            <span data-role="ledger-cut">
              تُعرض أحدث <Ltr>{LIMIT}</Ltr> إفادة فقط
            </span>
          ) : undefined
        }
      >
        <Timeline entries={entries} />
      </Panel>
    </div>
  );
}
