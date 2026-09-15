import Link from 'next/link';
import type { ReactElement } from 'react';
import type { Page, PartyRole, RelatedPartySummary } from '@nx-verify/core';
import type { SearchParams } from '../lib/pagination';
import { Card } from './ui/card';
import { Ltr } from './ui/ltr';
import { LinkedRows } from './ui/linked-rows';
import { ListPagination } from './ui/pagination';
import { Table, Th } from './ui/table';
import { Tag, TagLink } from './ui/tag';
import { count, dayMonthAr } from './format';

/**
 * The related parties (the owner's ask): whoever the customers name inside their files.
 *
 * The managers, partners, liquidators and guardians behind this subscriber's companies, one
 * row each however many companies they appear in: who they are with their number in full, the
 * roles they hold and where, how much of their authority is proven, and whether any of their
 * companies is no longer in good standing. Filtered by role, searched by name or number, and
 * each row opens a file shaped for a person.
 */

export type PartiesFilter = 'all' | PartyRole;

export interface PartiesView {
  page: Page<RelatedPartySummary>;
  params: SearchParams;
  counts: {
    all: number;
    MANAGER: number;
    PARTNER: number;
    LIQUIDATOR: number;
    GUARDIAN: number;
    concerns: number;
    several: number;
  };
  filter: PartiesFilter;
  concernsOnly: boolean;
  severalOnly: boolean;
  search: string;
  searchedByNumber: boolean;
  searchAction: string | ((formData: FormData) => Promise<void>);
}

/** «طرف واحد», «طرفان», «3 أطراف», «11 طرفاً». */
export function partiesCountAr(n: number): string {
  if (n === 1) {
    return 'طرف واحد';
  }
  if (n === 2) {
    return 'طرفان';
  }
  return n >= 3 && n <= 10 ? `${count(n)} أطراف` : `${count(n)} طرفاً`;
}

/** «منشأة واحدة», «منشأتان», «3 منشآت», «11 منشأة». */
export function businessesCountAr(n: number): string {
  if (n === 1) {
    return 'منشأة واحدة';
  }
  if (n === 2) {
    return 'منشأتان';
  }
  return n >= 3 && n <= 10 ? `${count(n)} منشآت` : `${count(n)} منشأة`;
}

/** «منشأة أخرى», «منشأتان أخريان», «3 منشآت أخرى», «11 منشأة أخرى». */
function othersAr(n: number): string {
  if (n === 1) {
    return 'منشأة أخرى';
  }
  if (n === 2) {
    return 'منشأتان أخريان';
  }
  return n >= 3 && n <= 10 ? `${count(n)} منشآت أخرى` : `${count(n)} منشأة أخرى`;
}

const ROLE_IN: Readonly<Record<PartyRole, string>> = {
  MANAGER: 'مدير في',
  PARTNER: 'شريك في',
  LIQUIDATOR: 'مصفٍّ في',
  GUARDIAN: 'ولي عن شريك في',
};

/** «مدير في 4 · شريك في 3». */
export function rolesLineAr(counts: Readonly<Record<PartyRole, number>>): string {
  return (Object.keys(ROLE_IN) as PartyRole[])
    .filter((role) => counts[role] > 0)
    .map((role) => `${ROLE_IN[role]} ${counts[role]}`)
    .join(' · ');
}

function href(
  filter: PartiesFilter,
  concernsOnly: boolean,
  severalOnly: boolean,
  search: string,
): string {
  const params = new URLSearchParams();
  if (filter !== 'all') {
    params.set('role', filter);
  }
  if (concernsOnly) {
    params.set('concerns', '1');
  }
  if (severalOnly) {
    params.set('several', '1');
  }
  if (search !== '') {
    params.set('q', search);
  }
  const query = params.toString();
  return query === '' ? '/customers/parties' : `/customers/parties?${query}`;
}

/** The companies of a row: the first three by name, and how many more. */
function CompaniesCell({ party }: { party: RelatedPartySummary }): ReactElement {
  const shown = party.companies.slice(0, 3);
  const more = party.companies.length - shown.length;
  return (
    <span className="parties-companies">
      {shown.map((company, index) => (
        <span key={company.entityId}>
          {index > 0 ? '، ' : ''}
          <Link href={`/customers/${company.entityId}`} data-role="party-company">
            {company.name ?? 'منشأة بلا اسم'}
          </Link>
        </span>
      ))}
      {more > 0 ? <span className="file-cell-note">و{othersAr(more)}</span> : null}
    </span>
  );
}

export function Parties({ view }: { view: PartiesView }): ReactElement {
  const { counts } = view;
  const filters: { filter: PartiesFilter; label: string; total: number }[] = [
    { filter: 'all', label: 'الكل', total: counts.all },
    { filter: 'MANAGER', label: 'مدراء', total: counts.MANAGER },
    { filter: 'PARTNER', label: 'شركاء', total: counts.PARTNER },
    { filter: 'LIQUIDATOR', label: 'مصفّون', total: counts.LIQUIDATOR },
    { filter: 'GUARDIAN', label: 'أولياء', total: counts.GUARDIAN },
  ];
  const plain = !view.concernsOnly && !view.severalOnly;

  return (
    <div className="customers" data-role="parties-screen">
      <header className="page-head home-head" data-role="page-header">
        <div className="page-head-text">
          <h1 className="page-title">الأطراف ذات العلاقة</h1>
          <p className="page-subtitle" data-role="parties-count">
            {partiesCountAr(counts.all)} يظهرون داخل ملفات عملائك: المدراء والشركاء والمصفّون
            والأولياء
          </p>
        </div>
      </header>

      <div className="customers-filters">
        <form action={view.searchAction} className="customers-search" role="search">
          <input type="hidden" name="role" value={view.filter} />
          <input
            className="input"
            name="q"
            type="search"
            defaultValue={view.search}
            placeholder="ابحث بالاسم أو رقم الهوية أو الوثيقة"
            aria-label="ابحث بالاسم أو رقم الهوية أو الوثيقة"
            autoComplete="off"
            maxLength={40}
          />
        </form>
        <nav className="customers-tags" aria-label="تصنيف الأطراف">
          {filters.map((entry) => (
            <TagLink
              key={entry.filter}
              href={href(entry.filter, false, false, view.search)}
              tone={entry.filter === view.filter && plain ? 'accent' : 'neutral'}
              current={entry.filter === view.filter && plain}
              role={`filter-${entry.filter}`}
            >
              {entry.label} · <Ltr>{count(entry.total)}</Ltr>
            </TagLink>
          ))}
          <TagLink
            href={href('all', false, !view.severalOnly, view.search)}
            tone={view.severalOnly ? 'accent' : 'outline'}
            current={view.severalOnly}
            role="filter-several"
          >
            في أكثر من منشأة · <Ltr>{count(counts.several)}</Ltr>
          </TagLink>
          <TagLink
            href={href('all', !view.concernsOnly, false, view.search)}
            tone={view.concernsOnly ? 'accent' : 'outline'}
            current={view.concernsOnly}
            role="filter-concerns"
          >
            منشآت بحاجة لنظر · <Ltr>{count(counts.concerns)}</Ltr>
          </TagLink>
        </nav>
      </div>

      {view.searchedByNumber ? (
        <p className="customers-searched" data-role="searched-by-number">
          نتائج البحث بالرقم ·{' '}
          <Link href={href(view.filter, view.concernsOnly, view.severalOnly, '')}>عرض الكل</Link>
        </p>
      ) : null}

      <Card as="section" variant="flush" label="قائمة الأطراف ذات العلاقة" role="parties">
        <div className="customers-table">
          {view.page.total === 0 ? (
            <p className="home-empty" data-role="empty-state">
              {view.search !== '' || view.searchedByNumber
                ? 'لا طرف يطابق هذا البحث.'
                : counts.all === 0
                  ? 'لا أطراف بعد. يظهر المدراء والشركاء هنا بعد التحقق من السجل التجاري أو عقد التأسيس لعملائك.'
                  : 'لا أطراف بهذا الوصف.'}
            </p>
          ) : (
            <Table label="الأطراف ذات العلاقة">
              <thead>
                <tr>
                  <Th>الطرف</Th>
                  <Th>الهوية</Th>
                  <Th>الأدوار</Th>
                  <Th>المنشآت</Th>
                  <Th>الصلاحيات</Th>
                  <Th>آخر رصد</Th>
                  <Th>
                    <span className="visually-hidden">الملف</span>
                  </Th>
                </tr>
              </thead>
              <LinkedRows>
                {view.page.rows.map((party) => (
                  <tr
                    key={party.entityId}
                    data-role="party-row"
                    data-party={party.entityId}
                    data-href={`/customers/${party.entityId}`}
                  >
                    <td>
                      {party.displayName ?? 'طرف بلا اسم'}
                      {party.nationality !== null || party.entityType === 'BUSINESS' ? (
                        <span className="file-cell-note">
                          {party.entityType === 'BUSINESS' ? 'جهة' : party.nationality}
                        </span>
                      ) : null}
                      {party.isCustomer ? (
                        <span className="file-cell-note">
                          <Tag tone="brand">عميل لديك</Tag>
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {party.identifier === null ? (
                        '·'
                      ) : (
                        <span className="file-identifier">
                          <span className="file-identifier-label">{party.identifier.labelAr}</span>{' '}
                          <Ltr>{party.identifier.display}</Ltr>
                        </span>
                      )}
                    </td>
                    <td data-role="party-roles">{rolesLineAr(party.roleCounts)}</td>
                    <td>
                      <CompaniesCell party={party} />
                      {party.concerns > 0 ? (
                        <span className="file-cell-note">
                          <Tag tone="accent" role="party-concerns">
                            {party.concerns === 1
                              ? 'منشأة بحاجة لنظر'
                              : `${businessesCountAr(party.concerns)} بحاجة لنظر`}
                          </Tag>
                        </span>
                      ) : null}
                    </td>
                    <td data-role="party-authority">
                      {party.roleCounts.MANAGER === 0 ? (
                        '·'
                      ) : party.authority.checkable === 0 ? (
                        <Tag tone="neutral">لا يتوفر تحقق</Tag>
                      ) : (
                        <Tag
                          tone={
                            party.authority.verified === party.authority.checkable
                              ? 'accent-2'
                              : 'neutral'
                          }
                        >
                          مثبتة في <Ltr>{party.authority.verified}</Ltr> من{' '}
                          <Ltr>{party.authority.checkable}</Ltr>
                        </Tag>
                      )}
                    </td>
                    <td>{dayMonthAr(party.lastSeenAt)}</td>
                    <td>
                      <Link
                        prefetch={false}
                        href={`/customers/${party.entityId}`}
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
            path="/customers/parties"
            params={view.params}
            label="صفحات الأطراف"
          />
        </div>
      </Card>
    </div>
  );
}
