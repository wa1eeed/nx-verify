import type { ReactElement } from 'react';
import { PAGE_SIZES, type Page } from '@nx-verify/core';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../shadcn/pagination';
import { pageHref, pageNumbers, type SearchParams } from '../../lib/pagination';
import { count } from '../format';
import { Ltr } from './ltr';
import { TagLink } from './tag';

/**
 * The pages of a long list (unit C): where the reader is, the way to the others, and how many
 * rows a page holds.
 *
 * Built on the shadcn/ui pagination, drawn in the system's pills. Every control is a link, so
 * a page can be opened in a new tab, bookmarked and shared, and the address says which page a
 * screen shows. With one page there is nothing to move between, and only the count is said.
 */
export function ListPagination({
  page,
  path,
  params,
  label,
  prefix,
}: {
  page: Pick<Page<unknown>, 'total' | 'page' | 'size' | 'pages'>;
  path: string;
  params: SearchParams;
  /** What the pages are of, for screen readers: «صفحات العملاء». */
  label: string;
  /** For a second list on the same screen, whose pages have their own parameters. */
  prefix?: string | undefined;
}): ReactElement | null {
  if (page.total === 0) {
    return null;
  }
  const first = (page.page - 1) * page.size + 1;
  const last = Math.min(page.page * page.size, page.total);

  return (
    <div className="list-pagination" data-role="pagination">
      <p className="list-pagination-summary">
        عرض <Ltr>{`${count(first)}–${count(last)}`}</Ltr> من <Ltr>{count(page.total)}</Ltr>
      </p>

      {page.pages > 1 ? (
        <Pagination aria-label={label} className="list-pagination-pages">
          <PaginationContent>
            <PaginationItem>
              {page.page > 1 ? (
                <PaginationPrevious
                  href={pageHref(path, params, page.page - 1, page.size, prefix)}
                  text="السابق"
                  aria-label="الصفحة السابقة"
                />
              ) : null}
            </PaginationItem>
            {pageNumbers(page.page, page.pages).map((entry, index) =>
              entry === 'gap' ? (
                <PaginationItem key={`gap-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={entry}>
                  <PaginationLink
                    href={pageHref(path, params, entry, page.size, prefix)}
                    isActive={entry === page.page}
                    aria-label={`الصفحة ${entry}`}
                  >
                    <Ltr>{entry}</Ltr>
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              {page.page < page.pages ? (
                <PaginationNext
                  href={pageHref(path, params, page.page + 1, page.size, prefix)}
                  text="التالي"
                  aria-label="الصفحة التالية"
                />
              ) : null}
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}

      {page.total > PAGE_SIZES[0] ? (
        <nav className="list-pagination-sizes" aria-label="عدد الصفوف في الصفحة">
          {PAGE_SIZES.map((size) => (
            <TagLink
              key={size}
              href={pageHref(path, params, 1, size, prefix)}
              tone={size === page.size ? 'accent' : 'neutral'}
              current={size === page.size}
            >
              <Ltr>{size}</Ltr>
            </TagLink>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
