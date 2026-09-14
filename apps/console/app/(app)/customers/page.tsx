import type { ReactElement } from 'react';
import { countCustomers, listCustomers, type CustomerKind } from '@nx-verify/core';
import { FreshnessBadge } from '../../../components/freshness';
import { TrustChip } from '../../../components/trust-dial';
import { query } from '../../../lib/context';
import { getKeys } from '../../../lib/keys';
import { SAVED_VIEWS, findCompletenessGaps, findView, listRegistry } from '../../../lib/views';
import { fieldLabel } from '../../../components/field-card';
import { EmptyState, PageHeader, Panel } from '../../../components/page-header';
import { Customers, type CustomersFilter } from '../../../components/customers';

/**
 * Never prerendered and never cached.
 *
 * This page reads one tenant's live data, and a build machine has no database and no
 * business holding a copy of it.
 */
export const dynamic = 'force-dynamic';

/**
 * The customers, and behind them the related records.
 *
 * Without a view, the customers a subscriber verified. With one, the registry of everything
 * else those verifications found: people, accounts, properties, one saved view per kind of
 * record (ADR-002), so a record type added later needs no screen of its own.
 */

const TRACKED_FIELDS = ['cr.status', 'address.national.city', 'manager.signing_authority'];
const KINDS = new Set<CustomerKind>(['COMPANY', 'ESTABLISHMENT', 'FREELANCER']);

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; kind?: string; q?: string }>;
}): Promise<ReactElement> {
  const params = await searchParams;

  if (params.view === undefined) {
    const kind = KINDS.has(params.kind as CustomerKind) ? (params.kind as CustomerKind) : null;
    const search = (params.q ?? '').trim().slice(0, 80);
    const data = await query(async (tx) => ({
      rows: await listCustomers(tx, getKeys(), { kind, search, limit: 200 }),
      counts: await countCustomers(tx),
    }));
    return (
      <Customers
        view={{
          rows: data.rows,
          counts: data.counts,
          filter: (kind ?? 'all') as CustomersFilter,
          search,
          now: new Date(),
        }}
      />
    );
  }

  const view = findView(params.view);
  const { rows, gaps } = await query(async (tx) => ({
    rows: await listRegistry(tx, view.entityType),
    gaps: await findCompletenessGaps(tx, view.entityType, TRACKED_FIELDS),
  }));

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader title="السجلات المرتبطة" subtitle={`${view.labelAr} التي ظهرت داخل ملفات عملائك. اضغط أي صف لفتح ملفه.`} />
      <nav className="muted" aria-label="مسار الصفحة">
        <a href="/customers">العملاء</a> / السجلات المرتبطة
      </nav>

      {/* The saved views are a strip that scrolls, not a wall of buttons that wraps. */}
      <nav className="tabs" aria-label="العروض المحفوظة">
        {SAVED_VIEWS.map((saved) => (
          <a
            key={saved.key}
            href={`/customers?view=${saved.key}`}
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

      <Panel title={view.labelAr} aside={`${rows.length} ${view.unitAr}`}>
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
            <tbody>
              {rows.map((row) => (
                <tr key={row.entityId}>
                  <td>
                    <a href={`/customers/${row.entityId}`}>{row.displayName ?? 'بلا اسم'}</a>
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
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? (
          <div className="panel-body">
            <EmptyState>لا شيء في هذا العرض بعد. أول تحقق يضع صفاً هنا.</EmptyState>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
