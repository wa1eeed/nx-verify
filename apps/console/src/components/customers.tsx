import Link from 'next/link';
import type { ReactElement } from 'react';
import type { CustomerSummary, Page } from '@nx-verify/core';
import type { SearchParams } from '../lib/pagination';
import { ButtonLink } from './ui/button';
import { Card } from './ui/card';
import { Ltr } from './ui/ltr';
import { ProgressBar } from './ui/progress-bar';
import { LinkedRows } from './ui/linked-rows';
import { ListPagination } from './ui/pagination';
import { Table, Th } from './ui/table';
import { Tag, TagLink, type TagTone } from './ui/tag';
import { count, dayMonthAr, shortMask } from './format';

/**
 * The customers (handoff screen 04).
 *
 * Every company, establishment and freelancer this subscriber verified, in one table: what
 * kind, its number masked, how complete the file is, where it stands, its risk, when it was
 * last verified, and the way into it. Filtered by kind, by open alerts or by the high risk
 * band, searched by name, number or IBAN. Each figure is the file's own (ADR-116).
 *
 * The «مخاطر عالية» facet is the one question this screen is opened to ask and could not
 * answer: the score each row shows is computed live, so a person had to read every page to
 * find the customers worth reading. It filters on the standing the sweep keeps, so it can lag
 * behind a score computed a second ago, exactly as «مكتمل» and «تنبيهات مفتوحة» already do.
 */

export type CustomersFilter = 'all' | 'COMPANY' | 'ESTABLISHMENT' | 'FREELANCER';

export interface CustomersView {
  /** The page of rows the filters and the search leave. */
  page: Page<CustomerSummary>;
  /** The address's parameters, so a page link keeps the filters. */
  params: SearchParams;
  counts: {
    all: number;
    companies: number;
    establishments: number;
    freelancers: number;
    complete: number;
    incomplete: number;
    alerts: number;
    highRisk: number;
  };
  filter: CustomersFilter;
  alertsOnly: boolean;
  /** Only the customers in this subscriber's high band, from the standing the sweep keeps. */
  highRiskOnly: boolean;
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

interface Facets {
  filter: CustomersFilter;
  alertsOnly: boolean;
  highRiskOnly: boolean;
  search: string;
}

function href(facets: Facets): string {
  const params = new URLSearchParams();
  if (facets.filter !== 'all') {
    params.set('kind', facets.filter);
  }
  if (facets.alertsOnly) {
    params.set('alerts', '1');
  }
  if (facets.highRiskOnly) {
    params.set('risk', 'high');
  }
  if (facets.search !== '') {
    params.set('q', facets.search);
  }
  const query = params.toString();
  return query === '' ? '/customers' : `/customers?${query}`;
}

export function Customers({ view }: { view: CustomersView }): ReactElement {
  const { counts } = view;
  // The three facets are one choice, as they have always been on this screen: picking a kind
  // clears the other two rather than intersecting with them.
  const plain = { alertsOnly: false, highRiskOnly: false, search: view.search };
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
          {view.highRiskOnly ? <input type="hidden" name="risk" value="high" /> : null}
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
          {filters.map((entry) => {
            const current = entry.filter === view.filter && !view.alertsOnly && !view.highRiskOnly;
            return (
              <TagLink
                key={entry.filter}
                href={href({ ...plain, filter: entry.filter })}
                tone={current ? 'accent' : 'neutral'}
                current={current}
                role={`filter-${entry.filter}`}
              >
                {entry.label} · <Ltr>{count(entry.total)}</Ltr>
              </TagLink>
            );
          })}
          <TagLink
            href={href({ ...plain, filter: 'all', alertsOnly: !view.alertsOnly })}
            tone={view.alertsOnly ? 'accent' : 'outline'}
            current={view.alertsOnly}
            role="filter-alerts"
          >
            تنبيهات مفتوحة · <Ltr>{count(counts.alerts)}</Ltr>
          </TagLink>
          <TagLink
            href={href({ ...plain, filter: 'all', highRiskOnly: !view.highRiskOnly })}
            tone={view.highRiskOnly ? 'accent' : 'outline'}
            current={view.highRiskOnly}
            role="filter-risk"
          >
            مخاطر عالية · <Ltr>{count(counts.highRisk)}</Ltr>
          </TagLink>
        </nav>
      </div>

      {view.searchedByNumber ? (
        <p className="customers-searched" data-role="searched-by-number">
          نتائج البحث بالرقم ·{' '}
          <Link
            href={href({
              filter: view.filter,
              alertsOnly: view.alertsOnly,
              highRiskOnly: view.highRiskOnly,
              search: '',
            })}
          >
            عرض الكل
          </Link>
        </p>
      ) : null}

      <Card as="section" variant="flush" label="قائمة العملاء" role="customers">
        <div className="customers-table">
          {view.page.total === 0 ? (
            <p className="home-empty" data-role="empty-state">
              {view.search !== '' || view.searchedByNumber
                ? 'لا عميل يطابق هذا البحث.'
                : view.alertsOnly
                  ? 'لا تنبيهات مفتوحة على أي عميل.'
                  : view.highRiskOnly
                    ? 'لا عميل ضمن نطاق المخاطر العالية.'
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
              <LinkedRows>
                {view.page.rows.map((row) => (
                  <tr
                    key={row.entityId}
                    data-role="customer-row"
                    data-customer={row.entityId}
                    data-href={`/customers/${row.entityId}`}
                  >
                    <td>{row.displayName ?? 'عميل بلا اسم بعد'}</td>
                    <td>{row.kindLabelAr}</td>
                    <td>{row.identifier ? <Ltr>{shortMask(row.identifier.display)}</Ltr> : '·'}</td>
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
                      <Link
                        prefetch={false}
                        href={`/customers/${row.entityId}`}
                        className="customers-open"
                        data-row-link
                      >
                        فتح الملف
                      </Link>
                    </td>
                  </tr>
                ))}
              </LinkedRows>
            </Table>
          )}
          <ListPagination
            page={view.page}
            path="/customers"
            params={view.params}
            label="صفحات العملاء"
          />
        </div>
      </Card>
    </div>
  );
}
