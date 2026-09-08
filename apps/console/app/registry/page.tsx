import type { ReactElement } from 'react';
import { FreshnessBadge } from '../../components/freshness';
import { query } from '../../lib/context';
import { SAVED_VIEWS, findCompletenessGaps, findView, listRegistry } from '../../lib/views';
import { fieldLabel } from '../../components/field-card';

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
    <div className="stack">
      <h1>السجل</h1>

      <nav className="row" aria-label="العروض المحفوظة">
        {SAVED_VIEWS.map((saved) => (
          <a
            key={saved.key}
            href={`/registry?view=${saved.key}`}
            className={saved.key === view.key ? 'btn-primary' : 'btn-secondary'}
            aria-current={saved.key === view.key ? 'page' : undefined}
          >
            {saved.labelAr}
          </a>
        ))}
      </nav>

      {gaps.length > 0 ? (
        <section className="card stack" data-role="completeness">
          <strong>فجوات الاكتمال</strong>
          <ul className="stack" style={{ gap: '4px', margin: 0 }}>
            {gaps.map((gap) => (
              <li key={gap.fieldPath}>
                {gap.missingEntities} كياناً بلا {fieldLabel(gap.fieldPath)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card">
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
        {rows.length === 0 ? <p className="muted">لا توجد كيانات في هذا العرض بعد.</p> : null}
      </section>
    </div>
  );
}
