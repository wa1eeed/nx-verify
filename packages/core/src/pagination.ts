/**
 * Pages of a long list.
 *
 * A screen that draws every row it has is slow to arrive and slower to read, so every long list
 * is read a page at a time: the query takes the page's offset and size, a second query counts
 * what the filters leave, and the page is clamped so an address that names a page past the end
 * shows the last one rather than an empty table.
 */

/** The page sizes a reader may choose, the first being the default. */
export const PAGE_SIZES = [25, 50, 100] as const;

export type PageSize = (typeof PAGE_SIZES)[number];

export interface PageRequest {
  /** From 1. */
  page: number;
  size: PageSize;
}

export interface Page<T> {
  rows: T[];
  /** Everything the filters leave, across every page. */
  total: number;
  page: number;
  size: PageSize;
  pages: number;
}

/** A page request from an address: anything malformed reads as the first page of the default size. */
export function pageRequestOf(raw: {
  page?: string | undefined;
  size?: string | undefined;
}): PageRequest {
  const size = PAGE_SIZES.find((candidate) => String(candidate) === raw.size) ?? PAGE_SIZES[0];
  const page = Number.parseInt(raw.page ?? '', 10);
  return { page: Number.isSafeInteger(page) && page >= 1 ? page : 1, size };
}

/** The page a request lands on once the total is known, and where its rows start. */
export function pageWindow(
  request: PageRequest,
  total: number,
): { page: number; pages: number; offset: number; limit: number } {
  const pages = Math.max(1, Math.ceil(total / request.size));
  const page = Math.min(request.page, pages);
  return { page, pages, offset: (page - 1) * request.size, limit: request.size };
}

/** A page of rows already in memory: the whole list was needed anyway, to count and to filter it. */
export function slicePage<T>(all: readonly T[], request: PageRequest): Page<T> {
  const window = pageWindow(request, all.length);
  return {
    rows: all.slice(window.offset, window.offset + window.limit),
    total: all.length,
    page: window.page,
    size: request.size,
    pages: window.pages,
  };
}

/** A page read from the database: count first, so the offset is clamped before the rows are read. */
export async function readPage<T>(
  request: PageRequest,
  count: () => Promise<number>,
  read: (window: { offset: number; limit: number }) => Promise<T[]>,
): Promise<Page<T>> {
  const total = await count();
  const window = pageWindow(request, total);
  const rows = total === 0 ? [] : await read({ offset: window.offset, limit: window.limit });
  return { rows, total, page: window.page, size: request.size, pages: window.pages };
}
