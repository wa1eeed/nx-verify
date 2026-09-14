import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HomeOverview, HomeRun } from '@nx-verify/core';

import { HomeScreen } from '../src/components/home';
import {
  costAr,
  greetingAr,
  packageLine,
  performanceAr,
  updatedAr,
} from '../src/components/home/model';

/**
 * Handoff phase 5: the subscriber's home screen, screen 01.
 *
 * Rendered from an overview whose every figure is chosen, so each rule of the screen is
 * asserted: the greeting follows Riyadh's hour, the four figures and their lines, one primary
 * action in the head, the operations with their status in the handoff's words and colours,
 * costs left to right, and the month's consumption in the accent then sage.
 */

const NOW = new Date('2026-09-14T14:42:00Z');

const run = (overrides: Partial<HomeRun> & Pick<HomeRun, 'runId'>): HomeRun => ({
  reference: 'VRF-2026-000001',
  productCode: 'CR_FULL',
  productNameAr: 'السجل التجاري',
  entityId: '6b7f4a0e-2d4c-4f5e-9a1b-0c3d2e1f4a5b',
  entityName: 'شركة أفق المدى للتقنية',
  entityType: 'BUSINESS',
  status: 'OK',
  decision: null,
  triggeredBy: 'CONSOLE',
  billedHalalas: 300,
  chargeSource: 'WALLET',
  createdAt: new Date('2026-09-14T06:00:00Z'),
  conflictAr: null,
  ...overrides,
});

const OVERVIEW: HomeOverview = {
  subscriberName: 'نُهج للحلول المالية',
  dataUpdatedAt: new Date('2026-09-14T06:42:00Z'),
  customers: { all: 339, verified: 312, verifiedThisMonth: 18, incomplete: 27, conflicts: 4 },
  commitment: { packageNameAr: 'باقة النمو', termEnd: new Date('2027-01-12T09:00:00Z') },
  recent: [
    run({ runId: 'r1' }),
    run({
      runId: 'r2',
      productCode: 'MANAGER_AUTHORITY',
      productNameAr: 'المدراء المفوضون',
      status: 'PENDING',
      billedHalalas: null,
    }),
    run({
      runId: 'r3',
      productCode: 'FREELANCE_CERTIFICATE',
      productNameAr: 'شهادة الفريلانسر',
      entityName: 'عبدالله الشمري',
      entityType: 'FREELANCER',
      chargeSource: 'PACKAGE',
    }),
    run({
      runId: 'r4',
      productCode: 'IBAN_VERIFICATION',
      productNameAr: 'الآيبان والحساب البنكي',
      entityName: 'شركة بنيان القابضة',
      conflictAr: 'تعارض في الاسم',
      billedHalalas: 150,
    }),
  ],
  consumption: [
    { productCode: 'CR_FULL', nameAr: 'السجل التجاري', count: 318 },
    { productCode: 'NATIONAL_ADDRESS', nameAr: 'العنوان الوطني', count: 241 },
    { productCode: 'IBAN_VERIFICATION', nameAr: 'الآيبان', count: 196 },
    { productCode: 'MANAGER_AUTHORITY', nameAr: 'المدراء المفوضون', count: 154 },
    { productCode: 'ARTICLES_OF_ASSOCIATION', nameAr: 'عقد التأسيس', count: 88 },
    { productCode: 'FREELANCE_CERTIFICATE', nameAr: 'شهادة الفريلانسر', count: 34 },
  ],
  performance: { runs: 1_000, averageMs: 6_400, completedShare: 0.991 },
};

function render(overview: HomeOverview = OVERVIEW, now: Date = NOW): string {
  return renderToStaticMarkup(<HomeScreen overview={overview} now={now} />);
}

function row(html: string, runId: string): string {
  return new RegExp(`<tr[^>]*data-run="${runId}"[^>]*>[\\s\\S]*?</tr>`).exec(html)?.[0] ?? '';
}

describe('the home screen of screen 01', () => {
  const html = render();

  it('greets the subscriber by the hour in Riyadh, and says when the data last changed', () => {
    expect(html).toContain('<h1 class="page-title">مساء الخير، نُهج للحلول المالية</h1>');
    expect(html).toContain('آخر تحديث للبيانات اليوم 14 سبتمبر 2026، 09:42');
    expect(greetingAr('نُهج', new Date('2026-09-14T05:00:00Z'))).toBe('صباح الخير، نُهج');
    expect(updatedAr(new Date('2026-09-12T06:42:00Z'), NOW)).toBe(
      'آخر تحديث للبيانات 12 سبتمبر 2026، 09:42',
    );
  });

  it('keeps one primary action in the head, beside the report', () => {
    const head = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
    expect(head.match(/btn-primary/g) ?? []).toHaveLength(1);
    expect(head).toMatch(/href="\/verifications\/new"[^>]*>[\s\S]*?تحقق جديد/);
    expect(head).toMatch(/href="\/dashboard\/report"[^>]*>[\s\S]*?تصدير التقرير/);
  });

  it('draws the four figures with their lines, the conflicts in the accent', () => {
    expect(html).toContain('عملاء متحققون');
    expect(html).toContain('<bdi dir="ltr" class="ltr">312</bdi>');
    expect(html).toContain('+18 هذا الشهر');
    expect(html).toContain('بحاجة قسم واحد أو أكثر');
    expect(html).toMatch(
      /class="home-stat-value" data-tone="attention"><bdi dir="ltr" class="ltr">4<\/bdi>/,
    );
    expect(html).toContain('data-tone="attention">تحتاج مراجعة يدوية</p>');
    expect(html).toContain('data-role="package" class="card card-stat card-tone-accent-2"');
    expect(html).toContain('تنتهي 12 يناير 2027');
    expect(html).toContain('120 يوماً متبقية');
  });

  it('starts a verification from a number, without putting it in an address', () => {
    const start = /data-role="quick-start-card"[\s\S]*?<\/form>/.exec(html)?.[0] ?? '';
    expect(start).toContain('ابدأ تحققاً جديداً');
    expect(start).toContain('aria-label="رقم السجل التجاري أو رقم الهوية"');
    // The form opens the request screen and sends nothing: the field has no name. It is a GET
    // the router makes without reloading the page, so it carries no method of its own.
    expect(start).toContain('action="/verifications/new"');
    expect(start).not.toMatch(/method="post"/i);
    expect(start).not.toMatch(/<input[^>]*name=/);
    expect(start).toMatch(/type="submit" class="btn btn-primary"[^>]*>متابعة/);
  });

  it('lists the latest operations in the handoff words, with costs left to right', () => {
    expect(row(html, 'r1')).toContain(
      'class="tag tag-accent-2" data-role="run-status">مُتحقق</span>',
    );
    expect(row(html, 'r1')).toContain('<bdi dir="ltr" class="ltr">3.00</bdi> ر.س');
    expect(row(html, 'r2')).toContain(
      'class="tag tag-neutral" data-role="run-status">قيد المعالجة</span>',
    );
    expect(row(html, 'r3')).toContain('عبدالله الشمري · عامل حر');
    expect(row(html, 'r3')).toContain('من الباقة');
    expect(row(html, 'r4')).toContain(
      'class="tag tag-accent" data-role="run-status">اسم غير مطابق</span>',
    );
    expect(html).toContain('href="/verifications"');
    // Each operation opens its customer's file, from anywhere on the row.
    expect(row(html, 'r1')).toContain(
      'data-href="/customers/6b7f4a0e-2d4c-4f5e-9a1b-0c3d2e1f4a5b"',
    );
  });

  it('draws the month consumption busiest first, in the accent then sage, with the note', () => {
    const fills = html.match(/progress-fill progress-fill-(accent-2|accent)"/g) ?? [];
    expect(fills).toEqual([
      'progress-fill progress-fill-accent"',
      'progress-fill progress-fill-accent"',
      'progress-fill progress-fill-accent"',
      'progress-fill progress-fill-accent-2"',
      'progress-fill progress-fill-accent-2"',
      'progress-fill progress-fill-accent-2"',
    ]);
    expect(html).toContain('style="inline-size:100%"');
    expect(html).toContain(
      'متوسط زمن الاستجابة 6.4 ثانية · 99.1% من العمليات اكتملت من المحاولة الأولى.',
    );
  });

  it('says so when there is nothing yet, and when there is no package', () => {
    const empty = render({
      ...OVERVIEW,
      dataUpdatedAt: null,
      customers: { all: 0, verified: 0, verifiedThisMonth: 0, incomplete: 0, conflicts: 0 },
      commitment: null,
      recent: [],
      consumption: [],
      performance: { runs: 0, averageMs: null, completedShare: null },
    });
    expect(empty).toContain('لم يُتحقق من أي عميل بعد');
    expect(empty).toContain('لا عمليات تحقق بعد.');
    expect(empty).toContain('لا عمليات هذا الشهر بعد.');
    expect(empty).toContain('لا باقة مفعّلة');
    expect(empty).not.toContain('data-role="performance"');
    expect(empty).not.toMatch(/class="home-stat-value" data-tone="attention"/);
    expect(
      packageLine({ packageNameAr: 'باقة', termEnd: new Date('2026-09-10T00:00:00Z') }, NOW)
        ?.endsAr,
    ).toBe('انتهت 10 سبتمبر 2026');
  });

  it('says a response time under a tenth of a second in words, and a whole share without a decimal', () => {
    expect(performanceAr({ runs: 12, averageMs: 8, completedShare: 1 })).toBe(
      'متوسط زمن الاستجابة أقل من 0.1 ثانية · 100% من العمليات اكتملت من المحاولة الأولى.',
    );
  });

  it('writes no em dash anywhere', () => {
    expect(html).not.toContain(String.fromCharCode(0x2014));
  });

  it('says what paid for an operation a package or a bundle covered, rather than a zero', () => {
    expect(costAr(run({ runId: 'p', chargeSource: 'PACKAGE', billedHalalas: 0 }))).toEqual({
      riyals: null,
      wordsAr: 'من الباقة',
    });
    expect(costAr(run({ runId: 'b', chargeSource: 'BUNDLE', billedHalalas: 0 }))).toEqual({
      riyals: null,
      wordsAr: 'من الحزمة',
    });
  });
});
