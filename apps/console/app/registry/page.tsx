import type { ReactElement } from 'react';
import { FreshnessBadge } from '../../components/freshness';
import { query } from '../../lib/context';
import { SAVED_VIEWS, findCompletenessGaps, findView, listRegistry } from '../../lib/views';
import { fieldLabel } from '../../components/field-card';
import { EmptyState, PageHeader, Panel } from '../../components/page-header';

/**
 * Never prerendered and never cached.
 *
 * This page reads one tenant's live data, and a build machine has no database and no
 * business holding a copy of it. Rendering it at request time is also what keeps a page
 * from showing a snapshot of somebody else's tenant after a deployment.
 */
export const dynamic = 'force-dynamic';

/**
 * The registry.
 *
 * One table for every entity type, and the tabs are saved views over it (ADR-002). Adding
 * a product adds rows, and it appears here without a line of interface code.
 */

const TRACKED_FIELDS = ['cr.status', 'address.national.city', 'manager.signing_authority'];

export default async function RegistryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const view = findView(params.view);

  const { rows, gaps } = await query(async (tx) => ({
    rows: await listRegistry(tx, view.entityType),
    gaps: await findCompletenessGaps(tx, view.entityType, TRACKED_FIELDS),
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="السجل"
        subtitle={`${view.labelAr}. كل صف كيان، وكل حقل فيه يحمل جهته وتاريخ رصده.`}
      />

      {/* The saved views are a strip that scrolls, not a wall of buttons that wraps. They
          are navigation, so none of them is the primary action of this screen. */}
      <nav className="tabs" aria-label="العروض المحفوظة">
        {SAVED_VIEWS.map((saved) => (
          <a
            key={saved.key}
            href={`/registry?view=${saved.key}`}
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
                {gap.missingEntities} كياناً بلا {fieldLabel(gap.fieldPath)}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="الكيانات" aside={`${rows.length} كياناً`}>
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>الكيان</th>
              <th>الحقول</th>
              <th>الحالة</th>
              <th>آخر ظهور</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.entityId}>
                <td>
                  <a href={`/entities/${row.entityId}`}>{row.displayName ?? 'بلا اسم'}</a>
                </td>
                <td>{row.fieldCount}</td>
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
          </tbody>
        </table>
        </div>
        {rows.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا كيانات في هذا العرض بعد. أول تحقق يضع كياناً هنا.</EmptyState>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
