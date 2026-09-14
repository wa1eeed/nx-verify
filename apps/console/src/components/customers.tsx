import type { ReactElement } from 'react';
import type { CustomerSummary } from '@nx-verify/core';
import { ButtonLink } from './ui/button';
import { Card } from './ui/card';
import { Ltr } from './ui/ltr';
import { ProgressBar } from './ui/progress-bar';
import { Table, Th } from './ui/table';
import { Tag, TagLink, type TagTone } from './ui/tag';
import { count, dayMonthAr, shortMask } from './format';

/**
 * The customers (handoff screen 04).
 *
 * Every company, establishment and freelancer this subscriber verified, in one table: what
 * kind, its number masked, how complete the file is, where it stands, its risk, when it was
 * last verified, and the way into it. Filtered by kind or by open alerts, searched by name,
 * number or IBAN. Each figure is the file's own (ADR-116).
 */

export type CustomersFilter = 'all' | 'COMPANY' | 'ESTABLISHMENT' | 'FREELANCER';

export interface CustomersView {
  /** The rows the filters and the search leave. */
  rows: CustomerSummary[];
  counts: {
    all: number;
    companies: number;
    establishments: number;
    freelancers: number;
    complete: number;
    incomplete: number;
    alerts: number;
  };
  filter: CustomersFilter;
  alertsOnly: boolean;
  /** A name searched for, kept in the field. */
  search: string;
  /** A number was searched for: it is not repeated, only said. */
  searchedByNumber: boolean;
  /** Where the search form posts, so a number never reaches an address. */
  searchAction: string | ((formData: FormData) => Promise<void>);
}

/** «339 ملفاً»: the count and the noun in the form Arabic gives that number. */
export function filesCountAr(n: number): string {
  if (n === 1) {
    return 'ملف واحد';
  }
  if (n === 2) {
    return 'ملفان';
  }
  return n >= 3 && n <= 10 ? `${count(n)} ملفات` : `${count(n)} ملفاً`;
}

function standingTone(summary: CustomerSummary): TagTone {
  return summary.standing === 'COMPLETE'
    ? 'accent-2'
    : summary.standing === 'DEFICIENT'
      ? 'accent'
      : 'neutral';
}

function href(filter: CustomersFilter, alertsOnly: boolean, search: string): string {
  const params = new URLSearchParams();
  if (filter !== 'all') {
    params.set('kind', filter);
  }
  if (alertsOnly) {
    params.set('alerts', '1');
  }
  if (search !== '') {
    params.set('q', search);
  }
  const query = params.toString();
  return query === '' ? '/customers' : `/customers?${query}`;
}

export function Customers({ view }: { view: CustomersView }): ReactElement {
  const { counts } = view;
  const filters: { filter: CustomersFilter; label: string; total: number }[] = [
    { filter: 'all', label: 'الكل', total: counts.all },
    { filter: 'COMPANY', label: 'شركات', total: counts.companies },
    { filter: 'ESTABLISHMENT', label: 'مؤسسات', total: counts.establishments },
    { filter: 'FREELANCER', label: 'عمّال أحرار', total: counts.freelancers },
  ];

  return (
    <div className="customers" data-role="customers-screen">
      <header className="page-head home-head" data-role="page-header">
        <div className="page-head-text">
          <h1 className="page-title">العملاء</h1>
          <p className="page-subtitle" data-role="customers-count">
            {filesCountAr(counts.all)} · {count(counts.complete)} مكتمل، {count(counts.incomplete)}{' '}
            ناقص
          </p>
        </div>
        <div className="page-head-actions">
          <ButtonLink
            href="/verifications/new"
            variant="primary"
            icon="plus"
            data-role="new-customer"
          >
            عميل جديد
          </ButtonLink>
        </div>
      </header>

      <div className="customers-filters">
        <form action={view.searchAction} className="customers-search" role="search">
          <input type="hidden" name="kind" value={view.filter} />
          {view.alertsOnly ? <input type="hidden" name="alerts" value="1" /> : null}
          <input
            className="input"
            name="q"
            type="search"
            defaultValue={view.search}
            placeholder="ابحث بالاسم أو رقم السجل أو الآيبان"
            aria-label="ابحث بالاسم أو رقم السجل أو الآيبان"
            autoComplete="off"
            maxLength={40}
          />
        </form>
        <nav className="customers-tags" aria-label="تصنيف العملاء">
          {filters.map((entry) => (
            <TagLink
              key={entry.filter}
              href={href(entry.filter, false, view.search)}
              tone={entry.filter === view.filter && !view.alertsOnly ? 'accent' : 'neutral'}
              current={entry.filter === view.filter && !view.alertsOnly}
              role={`filter-${entry.filter}`}
            >
              {entry.label} · <Ltr>{count(entry.total)}</Ltr>
            </TagLink>
          ))}
          <TagLink
            href={href('all', !view.alertsOnly, view.search)}
            tone={view.alertsOnly ? 'accent' : 'outline'}
            current={view.alertsOnly}
            role="filter-alerts"
          >
            تنبيهات مفتوحة · <Ltr>{count(counts.alerts)}</Ltr>
          </TagLink>
        </nav>
      </div>

      {view.searchedByNumber ? (
        <p className="customers-searched" data-role="searched-by-number">
          نتائج البحث بالرقم · <a href={href(view.filter, view.alertsOnly, '')}>عرض الكل</a>
        </p>
      ) : null}

      <Card as="section" variant="flush" label="قائمة العملاء" role="customers">
        <div className="customers-table">
          {view.rows.length === 0 ? (
            <p className="home-empty" data-role="empty-state">
              {view.search !== '' || view.searchedByNumber
                ? 'لا عميل يطابق هذا البحث.'
                : view.alertsOnly
                  ? 'لا تنبيهات مفتوحة على أي عميل.'
                  : counts.all === 0
                    ? 'لا عملاء بعد. أضف أول عميل وتحقق منه من زر «عميل جديد».'
                    : 'لا عملاء من هذا النوع بعد.'}
            </p>
          ) : (
            <Table label="العملاء">
              <thead>
                <tr>
                  <Th>العميل</Th>
                  <Th>النوع</Th>
                  <Th>رقم السجل / الهوية</Th>
                  <Th>الاكتمال</Th>
                  <Th>KYB</Th>
                  <Th>المخاطر</Th>
                  <Th>آخر تحقق</Th>
                  <Th>
                    <span className="visually-hidden">الملف</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.entityId} data-role="customer-row" data-customer={row.entityId}>
                    <td>{row.displayName ?? 'عميل بلا اسم بعد'}</td>
                    <td>{row.kindLabelAr}</td>
                    <td>{row.identifier ? <Ltr>{shortMask(row.identifier.masked)}</Ltr> : '·'}</td>
                    <td>
                      <span className="customers-completeness">
                        <span className="customers-bar">
                          <ProgressBar
                            value={row.completeness}
                            max={100}
                            label={`اكتمال ملف ${row.displayName ?? 'العميل'}`}
                            tone={row.completeness >= 75 ? 'accent-2' : 'accent'}
                          />
                        </span>
                        <Ltr>{row.completeness}%</Ltr>
                      </span>
                    </td>
                    <td>
                      <Tag tone={standingTone(row)} role="standing">
                        {row.standingAr}
                      </Tag>
                    </td>
                    <td data-role="risk">
                      {row.riskScore === null ? (
                        '·'
                      ) : (
                        <>
                          {row.riskLabelAr} · <Ltr>{row.riskScore}</Ltr>
                        </>
                      )}
                    </td>
                    <td>{row.lastVerifiedAt ? dayMonthAr(row.lastVerifiedAt) : '·'}</td>
                    <td>
                      <a href={`/customers/${row.entityId}`} className="customers-open">
                        فتح الملف
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}
