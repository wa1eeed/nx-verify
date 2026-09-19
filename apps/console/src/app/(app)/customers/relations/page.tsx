import Link from 'next/link';
import type { ReactElement } from 'react';
import { findEntitiesLinkedToMany } from '@nx-verify/core';
import { LinkedToMany } from '../../../../components/linked-to-many';
import { NoAccess } from '../../../../components/no-access';
import { FreshnessBadge } from '../../../../components/freshness';
import { TrustChip } from '../../../../components/trust-dial';
import { actingUser, query } from '../../../../lib/context';
import { SAVED_VIEWS, findCompletenessGaps, findView, pageRegistry } from '../../../../lib/views';
import { pageRequestFrom } from '../../../../lib/pagination';
import { LinkedRows } from '../../../../components/ui/linked-rows';
import { ListPagination } from '../../../../components/ui/pagination';
import { fieldLabel } from '../../../../components/field-card';
import { EmptyState, PageHeader, Panel } from '../../../../components/page-header';
import { SectionTabs } from '../../../../components/section-tabs';
import { CUSTOMER_TABS, visible } from '../../../../components/nav';

/** Never prerendered: one subscriber's live records. */
export const dynamic = 'force-dynamic';

/**
 * The links and relations behind the customers (handoff screen 00, «التقاطعات والعلاقات»).
 *
 * Everything the verifications found that is not itself a customer: the people, the
 * accounts, the properties, one saved view per kind of record (ADR-002), so a record type
 * added later needs no screen of its own. Every row is inside this subscriber's own scope
 * (ADR-112).
 */

const TRACKED_FIELDS = ['cr.status', 'address.national.city', 'manager.signing_authority'];

/**
 * How many customers a person has to appear in before it is worth saying.
 *
 * Three, because two is a coincidence a reader would have spotted anyway and four starts
 * hiding the ones worth a question. Not a setting: a threshold nobody can defend is a
 * threshold somebody will tune until the screen says nothing.
 */
const LINKED_THRESHOLD = 3;

/** The roles a relation carries, in the words the sentence needs. */
const LINKED_ROLES: readonly { relType: string; roleAr: string }[] = [
  { relType: 'MANAGES', roleAr: 'مديرون' },
  { relType: 'OWNS', roleAr: 'شركاء' },
  { relType: 'LIQUIDATES', roleAr: 'مصفّون' },
  { relType: 'REPRESENTS', roleAr: 'ممثلون' },
];

export default async function RelationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string; size?: string }>;
}): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('customers.read')) {
    return <NoAccess needs="customers.read" />;
  }
  const params = await searchParams;
  const view = findView(params.view);
  // A trust score is computed for the subject of a verification. A person is never one.
  const scored = view.entityType !== 'PERSON';
  const { page, gaps, linked } = await query(async (tx) => ({
    page: await pageRegistry(tx, view.entityType, pageRequestFrom(params)),
    gaps: await findCompletenessGaps(tx, view.entityType, TRACKED_FIELDS),
    // The half the screen's own title promised and never had: the query that answers it was
    // written, tested, exported and called by nothing (ADR-168).
    linked: await Promise.all(
      LINKED_ROLES.map(async (role) => ({
        relType: role.relType,
        roleAr: role.roleAr,
        parties: await findEntitiesLinkedToMany(tx, role.relType, LINKED_THRESHOLD),
      })),
    ),
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <SectionTabs tabs={visible(CUSTOMER_TABS, actor.capabilities)} current="/customers/relations" label="أقسام العملاء" />
      <PageHeader
        title="التقاطعات والعلاقات"
        subtitle={`${view.labelAr} التي ظهرت داخل ملفات عملائك. اضغط أي صف لفتح ملفه.`}
      />

      {/* The finding first, the lookup after it. */}
      <LinkedToMany groups={linked} threshold={LINKED_THRESHOLD} />

      {/* The saved views are a strip that scrolls, not a wall of buttons that wraps. */}
      <nav className="tabs" aria-label="العروض المحفوظة">
        {SAVED_VIEWS.map((saved) => (
          <Link
            key={saved.key}
            href={`/customers/relations?view=${saved.key}`}
            className="tab"
            aria-current={saved.key === view.key ? 'page' : undefined}
          >
            {saved.labelAr}
          </Link>
        ))}
      </nav>

      {view.entityType === 'PERSON' ? (
        <p className="customers-searched" data-role="parties-note">
          المدراء والشركاء والمصفّون وأدوارهم في منشآت عملائك في{' '}
          <Link href="/customers/parties">الأطراف ذات العلاقة</Link>.
        </p>
      ) : null}

      {gaps.length > 0 ? (
        <Panel title="فجوات الاكتمال" aside="ما ينقص لإغلاق ملف" role="completeness">
          <ul className="panel-body stack" style={{ gap: 'var(--s-2)', margin: 0 }}>
            {gaps.map((gap) => (
              <li key={gap.fieldPath}>
                {gap.missingEntities} {view.unitAr} بلا {fieldLabel(gap.fieldPath)}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title={view.labelAr} aside={`${page.total} ${view.unitAr}`}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                {/* «الحقول» is a count of what the verifications filled in on this record. */}
                <th>الحقول المعروفة</th>
                {/*
                  A score exists only for a record that was itself the subject of a
                  verification, and no seeded product takes a person as its subject, so this
                  column was structurally always blank on the people view (ADR-168).
                */}
                {scored ? <th>درجة الثقة</th> : null}
                <th>الحالة</th>
                <th>آخر ظهور</th>
              </tr>
            </thead>
            <LinkedRows>
              {page.rows.map((row) => (
                <tr key={row.entityId} data-href={`/customers/${row.entityId}`}>
                  <td>
                    <Link prefetch={false} href={`/customers/${row.entityId}`} data-row-link>
                      {row.displayName ?? 'بلا اسم'}
                    </Link>
                  </td>
                  <td>{row.fieldCount}</td>
                  {scored ? (
                    <td>
                      <TrustChip score={row.score} computedAt={row.scoreAt} />
                    </td>
                  ) : null}
                  <td>
                    <FreshnessBadge state={row.worstFreshness} />
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {row.lastSeenAt.toISOString().slice(0, 10)}
                    </bdi>
                  </td>
                </tr>
              ))}
            </LinkedRows>
          </table>
        </div>
        <div className="panel-body">
          <ListPagination
            page={page}
            path="/customers/relations"
            params={params}
            label={`صفحات ${view.labelAr}`}
          />
        </div>
        {page.total === 0 ? (
          <div className="panel-body">
            <EmptyState>لا شيء في هذا العرض بعد. أول تحقق يضع صفاً هنا.</EmptyState>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
