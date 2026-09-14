import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CustomerSummary } from '@nx-verify/core';
import { Customers, filesCountAr, type CustomersView } from '../src/components/customers';

/**
 * Handoff phase 6: the customers list, screen 04.
 *
 * Rows built from summaries whose every state is chosen: the count line, the filter tags with
 * the open one in the accent and alerts in outline, the completeness bar sage from 75% and
 * the accent below, the standing tag, the risk as «متوسطة · 46», numbers masked and left to
 * right, and a search that posts rather than putting a number in the address.
 */

const summary = (
  overrides: Partial<CustomerSummary> & Pick<CustomerSummary, 'entityId'>,
): CustomerSummary => ({
  displayName: 'شركة أفق المدى للتقنية',
  entityType: 'BUSINESS',
  kind: 'COMPANY',
  kindLabelAr: 'شركة',
  identifier: { labelAr: 'س.ت', masked: '••••••4567' },
  createdAt: new Date('2026-03-02T08:00:00Z'),
  lastVerifiedAt: new Date('2026-09-14T08:00:00Z'),
  firstVerifiedAt: new Date('2026-03-02T08:00:00Z'),
  completeness: 80,
  sectionsDone: 4,
  sectionsRequired: 5,
  mode: 'KYB',
  standing: 'COMPLETE',
  standingAr: 'مستوفى',
  riskLevel: 'MEDIUM',
  riskLabelAr: 'متوسطة',
  riskScore: 46,
  conflicts: 0,
  conflictIssues: [],
  openChanges: 0,
  openAlerts: 0,
  ...overrides,
});

const ROWS: CustomerSummary[] = [
  summary({ entityId: '11111111-1111-4111-8111-111111111111' }),
  summary({
    entityId: '22222222-2222-4222-8222-222222222222',
    displayName: 'شركة بنيان القابضة',
    completeness: 60,
    standing: 'DEFICIENT',
    standingAr: 'ناقص',
    riskLevel: 'HIGH',
    riskLabelAr: 'عالية',
    riskScore: 71,
  }),
  summary({
    entityId: '33333333-3333-4333-8333-333333333333',
    displayName: 'مؤسسة رمال الشرق للمقاولات',
    kind: 'ESTABLISHMENT',
    kindLabelAr: 'مؤسسة',
    completeness: 40,
    standing: 'IN_PROGRESS',
    standingAr: 'قيد الإكمال',
    riskLevel: 'INCOMPLETE',
    riskLabelAr: 'غير مكتملة',
    riskScore: null,
  }),
];

function view(overrides: Partial<CustomersView> = {}): CustomersView {
  return {
    rows: ROWS,
    counts: {
      all: 339,
      companies: 188,
      establishments: 106,
      freelancers: 45,
      complete: 312,
      incomplete: 27,
      alerts: 4,
    },
    filter: 'all',
    alertsOnly: false,
    search: '',
    searchedByNumber: false,
    searchAction: '/customers/search',
    ...overrides,
  };
}

const render = (overrides: Partial<CustomersView> = {}): string =>
  renderToStaticMarkup(<Customers view={view(overrides)} />);

function row(html: string, entityId: string): string {
  return new RegExp(`<tr[^>]*data-customer="${entityId}"[\\s\\S]*?</tr>`).exec(html)?.[0] ?? '';
}

describe('the customers of screen 04', () => {
  const html = render();

  it('heads the list with its count line and one primary action', () => {
    expect(html).toContain('<h1 class="page-title">العملاء</h1>');
    expect(html).toContain('data-role="customers-count">339 ملفاً · 312 مكتمل، 27 ناقص</p>');
    expect(html.match(/btn-primary/g) ?? []).toHaveLength(1);
    expect(filesCountAr(7)).toBe('7 ملفات');
    expect(filesCountAr(2)).toBe('ملفان');
  });

  it('filters by kind in neutral tags with the open one in the accent, and alerts in outline', () => {
    expect(html).toMatch(/class="tag tag-accent tag-link"[^>]*aria-current="true"[^>]*>الكل · /);
    expect(html).toMatch(
      /href="\/customers\?kind=COMPANY" class="tag tag-neutral tag-link"[^>]*>شركات · /,
    );
    expect(html).toMatch(
      /href="\/customers\?alerts=1" class="tag tag-outline tag-link"[^>]*>تنبيهات مفتوحة · /,
    );
    const alerts = render({ alertsOnly: true });
    expect(alerts).toMatch(
      /class="tag tag-accent tag-link"[^>]*aria-current="true"[^>]*>تنبيهات مفتوحة/,
    );
  });

  it('searches through a form that posts, so a number never reaches the address', () => {
    const search = /<form[^>]*role="search"[\s\S]*?<\/form>/.exec(html)?.[0] ?? '';
    expect(search).toContain('action="/customers/search"');
    expect(search).toContain('placeholder="ابحث بالاسم أو رقم السجل أو الآيبان"');
    expect(render({ searchedByNumber: true, rows: [] })).toContain('لا عميل يطابق هذا البحث.');
  });

  it('draws each row: kind, masked number, completeness, standing, risk, last check and the file', () => {
    const first = row(html, '11111111-1111-4111-8111-111111111111');
    expect(first).toContain('<td>شركة</td>');
    expect(first).toContain('<bdi dir="ltr" class="ltr">••••4567</bdi>');
    expect(first).toContain('progress-fill progress-fill-accent-2');
    expect(first).toContain('<bdi dir="ltr" class="ltr">80%</bdi>');
    expect(first).toContain('class="tag tag-accent-2" data-role="standing">مستوفى</span>');
    expect(first).toContain('متوسطة · <bdi dir="ltr" class="ltr">46</bdi>');
    expect(first).toContain('14 سبتمبر');
    expect(first).toContain('href="/customers/11111111-1111-4111-8111-111111111111"');

    const deficient = row(html, '22222222-2222-4222-8222-222222222222');
    expect(deficient).toContain('progress-fill progress-fill-accent"');
    expect(deficient).toContain('class="tag tag-accent" data-role="standing">ناقص</span>');

    const pending = row(html, '33333333-3333-4333-8333-333333333333');
    expect(pending).toContain('class="tag tag-neutral" data-role="standing">قيد الإكمال</span>');
    expect(pending).toContain('data-role="risk">·</td>');
  });

  it('says why the list is empty', () => {
    expect(render({ rows: [], counts: { ...view().counts, all: 0 } })).toContain(
      'لا عملاء بعد. أضف أول عميل وتحقق منه من زر «عميل جديد».',
    );
    expect(render({ rows: [], alertsOnly: true })).toContain('لا تنبيهات مفتوحة على أي عميل.');
  });

  it('writes no em dash anywhere', () => {
    expect(html).not.toContain(String.fromCharCode(0x2014));
  });
});
