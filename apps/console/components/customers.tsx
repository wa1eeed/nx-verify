import type { ReactElement } from 'react';
import type { CustomerCounts, CustomerKind, CustomerRow } from '@nx-verify/core';
import { EmptyState, PageHeader, Panel } from './page-header';
import { count, isoDate, sinceAr } from './format';

/**
 * The customers: every company, establishment and freelancer this subscriber verified.
 *
 * One list, filtered by kind, searchable by name or by number. Each row answers the three
 * things a person scans a customer list for: what kind of customer, whether their record is
 * in good standing, and whether something about them needs a look. The rest is one click
 * away in the file.
 */

export type CustomersFilter = 'all' | 'COMPANY' | 'ESTABLISHMENT' | 'FREELANCER';

export interface CustomersView {
  rows: CustomerRow[];
  counts: CustomerCounts;
  filter: CustomersFilter;
  search: string;
  now: Date;
}

const KIND_LABELS: Readonly<Record<CustomerKind, string>> = {
  COMPANY: 'شركة',
  ESTABLISHMENT: 'مؤسسة',
  FREELANCER: 'عامل حر',
};

function tabHref(filter: CustomersFilter, search: string): string {
  const params = new URLSearchParams();
  if (filter !== 'all') {
    params.set('kind', filter);
  }
  if (search !== '') {
    params.set('q', search);
  }
  const query = params.toString();
  return query === '' ? '/customers' : `/customers?${query}`;
}

export function Customers({ view }: { view: CustomersView }): ReactElement {
  const tabs: { filter: CustomersFilter; label: string; total: number }[] = [
    { filter: 'all', label: 'الكل', total: view.counts.all },
    { filter: 'COMPANY', label: 'الشركات', total: view.counts.companies },
    { filter: 'ESTABLISHMENT', label: 'المؤسسات', total: view.counts.establishments },
    { filter: 'FREELANCER', label: 'العاملون الأحرار', total: view.counts.freelancers },
  ];

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="العملاء"
        subtitle="كل منشأة وعامل حر تحققت منه، بتصنيفه وحالته وآخر تحقق عليه."
        action={
          <a className="btn-primary" href="/customers/new" data-role="new-customer">
            عميل جديد
          </a>
        }
      />

      <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--s-3)' }}>
        <nav className="tabs" aria-label="تصنيف العملاء" style={{ paddingBlockEnd: 0 }}>
          {tabs.map((tab) => (
            <a
              key={tab.filter}
              className="tab"
              href={tabHref(tab.filter, view.search)}
              {...(tab.filter === view.filter ? { 'aria-current': 'page' as const } : {})}
            >
              {tab.label}{' '}
              <bdi dir="ltr" className="mono">
                {count(tab.total)}
              </bdi>
            </a>
          ))}
        </nav>
        <form
          method="get"
          action="/customers"
          className="row"
          style={{ gap: 'var(--s-2)' }}
          role="search"
        >
          {view.filter !== 'all' ? <input type="hidden" name="kind" value={view.filter} /> : null}
          <input
            name="q"
            defaultValue={view.search}
            placeholder="اسم أو رقم موحد أو هوية"
            aria-label="بحث في العملاء"
            style={{ width: '16rem' }}
          />
          <button type="submit" className="btn-secondary">
            بحث
          </button>
        </form>
      </div>

      <Panel
        title={tabs.find((tab) => tab.filter === view.filter)?.label ?? 'الكل'}
        aside={`${view.rows.length}`}
        role="customers"
      >
        {view.rows.length === 0 ? (
          <div className="panel-body">
            <EmptyState>
              {view.search !== ''
                ? 'لا عميل يطابق هذا البحث.'
                : 'لا عملاء بعد. أضف أول عميل وتحقق منه من زر «عميل جديد».'}
            </EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>العميل</th>
                  <th>الحالة</th>
                  <th>آخر تحقق</th>
                  <th>يستحق الانتباه</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.entityId} data-role="customer-row">
                    <td>
                      <a href={`/customers/${row.entityId}`}>{row.displayName ?? 'بلا اسم بعد'}</a>{' '}
                      <span className="chip" data-kind={row.kind ?? 'UNKNOWN'}>
                        {row.kind ? KIND_LABELS[row.kind] : 'منشأة'}
                      </span>
                    </td>
                    <td>
                      {row.statusText ? (
                        <span className="badge" data-tone={row.statusTone}>
                          {row.statusText}
                        </span>
                      ) : (
                        <span className="faint">لم يُتحقق بعد</span>
                      )}
                      {row.expiredFacts > 0 ? (
                        <span
                          className="badge"
                          data-tone="expired"
                          style={{ marginInlineStart: 6 }}
                        >
                          معلومات منتهية
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {row.lastVerifiedAt ? (
                        <span className="stack" style={{ gap: 0 }}>
                          <span>{sinceAr(row.lastVerifiedAt, view.now)}</span>
                          <bdi dir="ltr" className="mono faint">
                            {isoDate(row.lastVerifiedAt)}
                          </bdi>
                        </span>
                      ) : (
                        <span className="faint">لا يوجد</span>
                      )}
                    </td>
                    <td>
                      {row.attention > 0 ? (
                        <span className="badge" data-tone="critical" data-role="attention">
                          <bdi dir="ltr" className="mono">
                            {row.attention}
                          </bdi>
                        </span>
                      ) : (
                        <span className="faint">لا شيء</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="faint">
        الأشخاص والحسابات والعقارات التي تظهر داخل ملفات العملاء تُعرض في{' '}
        <a href="/customers?view=people">السجلات المرتبطة</a>.
      </p>
    </div>
  );
}
