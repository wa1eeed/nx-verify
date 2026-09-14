import type { ReactElement } from 'react';
import { FreshnessBadge } from '../../../../components/freshness';
import { TrustChip } from '../../../../components/trust-dial';
import { query } from '../../../../lib/context';
import { SAVED_VIEWS, findCompletenessGaps, findView, pageRegistry } from '../../../../lib/views';
import { pageRequestFrom } from '../../../../lib/pagination';
import { LinkedRows } from '../../../../components/ui/linked-rows';
import { ListPagination } from '../../../../components/ui/pagination';
import { fieldLabel } from '../../../../components/field-card';
import { EmptyState, PageHeader, Panel } from '../../../../components/page-header';
import { SectionTabs } from '../../../../components/section-tabs';
import { CUSTOMER_TABS } from '../../../../components/nav';

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

export default async function RelationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string; size?: string }>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const view = findView(params.view);
  const { page, gaps } = await query(async (tx) => ({
    page: await pageRegistry(tx, view.entityType, pageRequestFrom(params)),
    gaps: await findCompletenessGaps(tx, view.entityType, TRACKED_FIELDS),
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <SectionTabs tabs={CUSTOMER_TABS} current="/customers/relations" label="أقسام العملاء" />
      <PageHeader
        title="التقاطعات والعلاقات"
        subtitle={`${view.labelAr} التي ظهرت داخل ملفات عملائك. اضغط أي صف لفتح ملفه.`}
      />

      {/* The saved views are a strip that scrolls, not a wall of buttons that wraps. */}
      <nav className="tabs" aria-label="العروض المحفوظة">
        {SAVED_VIEWS.map((saved) => (
          <a
            key={saved.key}
            href={`/customers/relations?view=${saved.key}`}
            className="tab"
            aria-current={saved.key === view.key ? 'page' : undefined}
          >
            {saved.labelAr}
          </a>
        ))}
      </nav>

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
                <th>الحقول</th>
                <th>درجة الثقة</th>
                <th>الحالة</th>
                <th>آخر ظهور</th>
              </tr>
            </thead>
            <LinkedRows>
              {page.rows.map((row) => (
                <tr key={row.entityId} data-href={`/customers/${row.entityId}`}>
                  <td>
                    <a href={`/customers/${row.entityId}`} data-row-link>
                      {row.displayName ?? 'بلا اسم'}
                    </a>
                  </td>
                  <td>{row.fieldCount}</td>
                  <td>
                    <TrustChip score={row.score} computedAt={row.scoreAt} />
                  </td>
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
