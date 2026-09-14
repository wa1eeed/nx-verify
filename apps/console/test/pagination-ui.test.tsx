import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { pageHref, pageNumbers, pageRequestFrom } from '../src/lib/pagination';
import { ListPagination } from '../src/components/ui/pagination';
import { LinkedRows } from '../src/components/ui/linked-rows';

/**
 * The interface unit: the pages of a long list, and rows that open what they are about.
 */

describe('pages in the address', () => {
  it('keeps every other parameter, and writes neither page nor size for the first default page', () => {
    expect(pageHref('/customers', { kind: 'COMPANY', page: '3' }, 1, 25)).toBe(
      '/customers?kind=COMPANY',
    );
    expect(pageHref('/customers', { kind: 'COMPANY' }, 2, 50)).toBe(
      '/customers?kind=COMPANY&page=2&size=50',
    );
  });

  it('gives a second list on a screen parameters of its own', () => {
    const params = { page: '2', stale_page: '4' };
    expect(pageRequestFrom(params, 'stale')).toEqual({ page: 4, size: 25 });
    expect(pageHref('/customers/alerts', params, 5, 25, 'stale')).toBe(
      '/customers/alerts?page=2&stale_page=5',
    );
  });

  it('shows the first page, the last, and the current one with its neighbours', () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
    expect(pageNumbers(2, 3)).toEqual([1, 2, 3]);
  });
});

describe('the pagination bar', () => {
  const render = (page: number, total: number): string =>
    renderToStaticMarkup(
      <ListPagination
        page={{ page, size: 25, total, pages: Math.max(1, Math.ceil(total / 25)) }}
        path="/verifications"
        params={{ status: 'OK' }}
        label="صفحات سجل العمليات"
      />,
    );

  it('says where the reader is and links the pages, the current one marked', () => {
    const html = render(2, 80);
    expect(html).toContain('aria-label="صفحات سجل العمليات"');
    expect(html).toMatch(
      /عرض <bdi dir="ltr" class="ltr">26–50<\/bdi> من <bdi dir="ltr" class="ltr">80<\/bdi>/,
    );
    expect(html).toContain('href="/verifications?status=OK&amp;page=3"');
    expect(html).toContain('aria-label="الصفحة السابقة"');
    expect(html).toContain('aria-label="الصفحة التالية"');
    expect(html).toMatch(
      /aria-current="page"[^>]*aria-label="الصفحة 2"|aria-label="الصفحة 2"[^>]*aria-current="page"/,
    );
    // The sizes keep the filters and start again from the first page.
    expect(html).toContain('href="/verifications?status=OK&amp;size=50"');
  });

  it('offers no way back from the first page, no way on from the last, and nothing for an empty list', () => {
    expect(render(1, 80)).not.toContain('الصفحة السابقة');
    expect(render(4, 80)).not.toContain('الصفحة التالية');
    expect(render(1, 0)).toBe('');
    // One page: the count alone, with nothing to move between.
    const single = render(1, 7);
    expect(single).toContain('من <bdi dir="ltr" class="ltr">7</bdi>');
    expect(single).not.toContain('data-slot="pagination"');
    expect(single).not.toContain('عدد الصفوف في الصفحة');
  });
});

describe('rows that open what they are about', () => {
  it('renders a table body that answers presses, around rows that keep their links', () => {
    const html = renderToStaticMarkup(
      <table>
        <LinkedRows>
          <tr data-href="/customers/1">
            <td>
              <a href="/customers/1" data-row-link>
                شركة
              </a>
            </td>
          </tr>
        </LinkedRows>
      </table>,
    );
    expect(html).toContain('<tbody class="linked-rows"><tr data-href="/customers/1">');
    expect(html).toContain('data-row-link="true"');
  });
});
