import { PAGE_SIZES, pageRequestOf, type PageRequest } from '@nx-verify/core';

/**
 * Pages in the address.
 *
 * `?page=3&size=50`, read and written here once, so every list reads them the same way and a
 * link to another page keeps the filters the reader chose. The first page of the default size
 * writes neither, so the address of an unpaged list does not change.
 */

export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The parameter names of a list: `page` and `size`, or `stale_page` for a second list on a screen. */
function keys(prefix: string | undefined): { page: string; size: string } {
  return prefix
    ? { page: `${prefix}_page`, size: `${prefix}_size` }
    : { page: 'page', size: 'size' };
}

export function pageRequestFrom(params: SearchParams, prefix?: string): PageRequest {
  const names = keys(prefix);
  return pageRequestOf({ page: single(params[names.page]), size: single(params[names.size]) });
}

export function pageHref(
  path: string,
  params: SearchParams,
  page: number,
  size: number,
  prefix?: string,
): string {
  const names = keys(prefix);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === names.page || key === names.size || value === undefined) {
      continue;
    }
    for (const entry of Array.isArray(value) ? value : [value]) {
      query.append(key, entry);
    }
  }
  if (page > 1) {
    query.set(names.page, String(page));
  }
  if (size !== PAGE_SIZES[0]) {
    query.set(names.size, String(size));
  }
  const text = query.toString();
  return text === '' ? path : `${path}?${text}`;
}

/** The page numbers to show: the first, the last, and the current one with a neighbour each side. */
export function pageNumbers(page: number, pages: number): (number | 'gap')[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  for (const n of sorted) {
    const previous = out[out.length - 1];
    if (typeof previous === 'number' && n - previous > 1) {
      out.push('gap');
    }
    out.push(n);
  }
  return out;
}
