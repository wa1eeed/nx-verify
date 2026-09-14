import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SubscriberBoardRow, SubscriberDetail, SubscribersBoard } from '@nx-verify/core';
import { AdminSubscribers } from '../src/components/admin-subscribers';
import { AdminSubscriber } from '../src/components/admin-subscribers/detail';
import {
  activeLineAr,
  balanceCellAr,
  endsAr,
  planCellAr,
  revenueLineAr,
  subscribersCsv,
  wholeRiyalsAr,
} from '../src/components/admin-subscribers/model';

/**
 * Handoff phase 8: the subscribers and their balances of screen 06, and one subscriber managed.
 */

const EM_DASH = String.fromCharCode(0x2014);
const noop = async (): Promise<void> => undefined;
const create = async () => null;

function row(overrides: Partial<SubscriberBoardRow> & Pick<SubscriberBoardRow, 'tenantId'>) {
  const base: SubscriberBoardRow = {
    tenantId: overrides.tenantId,
    legalName: 'نُهج للحلول المالية',
    slug: 'nahj',
    packageCode: 'GROWTH',
    packageNameAr: 'النمو',
    billingModel: 'MONTHLY',
    status: 'active',
    termStart: new Date('2026-01-12T00:00:00Z'),
    termEnd: new Date('2027-01-12T09:00:00Z'),
    daysLeft: 120,
    includedTransactions: 1200,
    transactionsUsed: 360,
    transactionsLeft: 840,
    balanceHalalas: 0,
    heldHalalas: 0,
    availableHalalas: 0,
    lowBalance: false,
    hasSandbox: false,
    bundleOperations: 1000,
    bundleGranted: 2000,
    largestBundle: 2000,
    operationsLeft: 1840,
    operationsBought: 3200,
    runs30: 1031,
    hasSpecialPrice: true,
    standing: 'ACTIVE',
  };
  return { ...base, ...overrides };
}

const ROWS: SubscriberBoardRow[] = [
  row({ tenantId: 't-1' }),
  row({
    tenantId: 't-2',
    legalName: 'منصة تمويلي',
    operationsLeft: 210,
    standing: 'LOW_BALANCE',
  }),
  row({
    tenantId: 't-3',
    legalName: 'شركة إيجار الأول',
    packageNameAr: 'البداية',
    hasSpecialPrice: false,
    standing: 'EXPIRING',
  }),
  row({
    tenantId: 't-4',
    legalName: 'محفظة سند',
    packageNameAr: 'الدفع لكل عملية',
    billingModel: 'PAYG',
    largestBundle: 10_000,
    operationsLeft: 7455,
    hasSpecialPrice: false,
  }),
  row({
    tenantId: 't-5',
    legalName: 'تقسيط بلس',
    operationsLeft: 0,
    hasSpecialPrice: false,
    standing: 'SUSPENDED',
  }),
];

const BOARD: SubscribersBoard = {
  rows: ROWS,
  active: 41,
  expiringSoon: 3,
  revenue: {
    thisMonthHalalas: 218_400_00,
    lastMonthHalalas: 196_756_76,
    changePct: 11,
    lastMonthStart: new Date('2026-08-01T00:00:00Z'),
  },
  runsThisMonth: 26_448,
  unconsumedOperations: 61_920,
  needsAction: 5,
};

const render = (canManage = true, board: SubscribersBoard = BOARD): string =>
  renderToStaticMarkup(
    <AdminSubscribers
      view={{
        board,
        expiringWindowDays: 14,
        canManage,
        plans: [{ code: 'GROWTH', nameAr: 'النمو' }],
      }}
      createAction={create}
    />,
  );

describe('the subscribers screen (handoff screen 06)', () => {
  const html = render();

  it('says the approved words of the screen', () => {
    for (const text of [
      'المشتركون',
      '41 مشتركاً نشطاً · 3 اشتراكات تنتهي خلال 14 يوماً',
      'تصدير',
      'مشترك جديد',
      'إيراد الشهر',
      '218,400 ر.س',
      '+11% عن أغسطس',
      'عمليات التحقق',
      '26,448',
      'هذا الشهر',
      'رصيد غير مستهلك',
      '61,920',
      'عملية عبر كل المشتركين',
      'تحتاج إجراء',
      'رصيد منخفض أو اشتراك منتهٍ',
      'المشترك',
      'الباقة',
      'الرصيد المتبقي',
      'ينتهي في',
      'استهلاك 30 يوماً',
      'سعر خاص',
      'الحالة',
      'إدارة',
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain(EM_DASH);
  });

  it('has one primary button in its head, and the export beside it', () => {
    const head = html
      .slice(0, html.indexOf('data-role="subscriber-figures"'))
      .replace(/<dialog[\s\S]*?<\/dialog>/g, '');
    expect(head.match(/<button[^>]*btn-primary/g)).toHaveLength(1);
    expect(head).toContain('href="/operator/subscribers/export"');
  });

  it('draws the attention card in its own tone', () => {
    expect(html).toMatch(/class="card card-stat card-tone-attention"[^>]*>/);
  });

  it('tags each subscriber by where it stands, in the tones of the handoff', () => {
    expect(html).toContain(
      '<span class="tag tag-accent-2" data-role="subscriber-standing">نشط</span>',
    );
    expect(html).toContain(
      '<span class="tag tag-accent" data-role="subscriber-standing">رصيد منخفض</span>',
    );
    expect(html).toContain(
      '<span class="tag tag-accent" data-role="subscriber-standing">ينتهي قريباً</span>',
    );
    expect(html).toContain(
      '<span class="tag tag-critical" data-role="subscriber-standing">موقوف</span>',
    );
  });

  it('writes a bundle subscriber plan and term as the handoff does', () => {
    expect(html).toContain('حزمة 10,000');
    expect(html).toContain('لا ينتهي');
    expect(html).toContain('href="/operator/subscribers/t-4"');
  });

  it('offers a role that may only look the export and not a new subscriber', () => {
    const readOnly = render(false);
    expect(readOnly).toContain('تصدير');
    expect(readOnly).not.toContain('data-role="new-subscriber"');
  });

  it('has an empty state that says what to do', () => {
    const empty = render(true, { ...BOARD, rows: [], active: 0, expiringSoon: 0 });
    expect(empty).toContain('لا مشترك بعد. أضف أول مشترك من «مشترك جديد».');
    expect(empty).toContain('لا مشترك نشط · لا اشتراك ينتهي خلال 14 يوماً');
  });
});

describe('the words and figures of screen 06', () => {
  it('counts subscribers and endings in the forms Arabic gives each number', () => {
    expect(activeLineAr(1, 1, 14)).toBe('مشترك واحد نشط · اشتراك واحد ينتهي خلال 14 يوماً');
    expect(activeLineAr(2, 2, 14)).toBe('مشتركان نشطان · اشتراكان ينتهيان خلال 14 يوماً');
    expect(activeLineAr(7, 3, 14)).toBe('7 مشتركين نشطين · 3 اشتراكات تنتهي خلال 14 يوماً');
    expect(activeLineAr(41, 12, 14)).toBe('41 مشتركاً نشطاً · 12 اشتراكاً ينتهي خلال 14 يوماً');
    expect(activeLineAr(100, 0, 14)).toBe('100 مشترك نشط · لا اشتراك ينتهي خلال 14 يوماً');
  });

  it('compares the month with the month before, and says so when there is nothing to compare', () => {
    const august = new Date('2026-08-01T00:00:00Z');
    expect(revenueLineAr(11, august)).toEqual({ textAr: '+11% عن أغسطس', tone: 'up' });
    expect(revenueLineAr(-4, august)).toEqual({ textAr: '−4% عن أغسطس', tone: 'down' });
    expect(revenueLineAr(null, august)).toEqual({
      textAr: 'لا إيراد في أغسطس للمقارنة',
      tone: 'none',
    });
    expect(wholeRiyalsAr(218_400_49)).toBe('218,400 ر.س');
  });

  it('says a plan, a balance and a term for each kind of subscriber', () => {
    const wallet = row({
      tenantId: 'w',
      billingModel: 'PAYG',
      packageNameAr: 'الدفع لكل عملية',
      largestBundle: null,
      operationsLeft: null,
      availableHalalas: 5_595_00,
    });
    expect(planCellAr(wallet)).toBe('الدفع لكل عملية');
    expect(balanceCellAr(wallet)).toBe('5,595.00 ر.س');
    expect(endsAr(wallet)).toBe('لا ينتهي');
    expect(planCellAr(ROWS[0] as SubscriberBoardRow)).toBe('النمو');
    expect(balanceCellAr(ROWS[0] as SubscriberBoardRow)).toBe('1,840');
    expect(endsAr(ROWS[0] as SubscriberBoardRow)).toBe('12 يناير 2027');
  });

  it('exports the table for a spreadsheet, never reading a cell as a formula', () => {
    const csv = subscribersCsv([row({ tenantId: 'x', legalName: '=HYPERLINK("x")' }), ...ROWS]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, first] = csv.slice(1).split('\r\n');
    expect(header).toBe(
      'المشترك,مساحة العمل,الباقة,الرصيد المتبقي,ينتهي في,استهلاك 30 يوماً,سعر خاص,الحالة',
    );
    expect(first?.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
    expect(csv).toContain('تقسيط بلس,nahj,النمو,0,12 يناير 2027,1031,لا,موقوف');
  });
});

describe('one subscriber, managed', () => {
  const detail: SubscriberDetail = {
    ...row({ tenantId: 't-1' }),
    createdAt: new Date('2026-01-10T09:00:00Z'),
    platformFeeHalalas: 290_000,
    usage: [
      {
        productCode: 'CR_FULL',
        productNameAr: 'السجل التجاري',
        runs: 12,
        packageRuns: 10,
        billedHalalas: 600,
        costHalalas: 220,
      },
    ],
    topUps: [
      {
        reference: 'TOP-2026-000004',
        amountHalalas: 10_000_00,
        status: 'CONFIRMED',
        requestedAt: new Date('2026-09-01T09:00:00Z'),
        settledAt: new Date('2026-09-02T09:00:00Z'),
        bundleCode: 'BUNDLE_500',
      },
    ],
    bundles: [
      {
        bundleCode: 'BUNDLE_500',
        operations: 500,
        used: 120,
        grantedAt: new Date('2026-09-02T09:00:00Z'),
        expiresAt: new Date('2027-09-02T09:00:00Z'),
      },
    ],
  };

  const renderDetail = (overrides: { canManage?: boolean; status?: string } = {}): string =>
    renderToStaticMarkup(
      <AdminSubscriber
        view={{
          detail,
          row: row({ tenantId: 't-1', status: overrides.status ?? 'active' }),
          canManage: overrides.canManage ?? true,
          plans: [{ code: 'GROWTH', nameAr: 'النمو' }],
          specialPrice: {
            tenantId: 't-1',
            legalName: 'نُهج للحلول المالية',
            discountPct: 18,
            products: [],
          },
          notice: null,
        }}
        actions={{ setSuspended: noop, assignPlan: noop }}
      />,
    );

  it('shows the plan, the bundles, the special prices, the use and the transfers', () => {
    const html = renderDetail();
    expect(html).toContain('data-role="subscriber-plan"');
    expect(html).toContain('حزمة 500 عملية');
    expect(html).toContain('380 / 500');
    expect(html).toContain('خصم 18% على كل المنتجات');
    expect(html).toContain('data-role="subscriber-usage"');
    expect(html).toContain('TOP-2026-000004');
    expect(html).toContain('data-role="suspend-subscriber"');
    expect(html).not.toContain(EM_DASH);
  });

  it('offers to resume a suspended subscriber, and no controls to a role that may only look', () => {
    expect(renderDetail({ status: 'suspended' })).toContain('data-role="resume-subscriber"');
    const readOnly = renderDetail({ canManage: false });
    expect(readOnly).not.toContain('data-role="suspend-subscriber"');
    expect(readOnly).not.toContain('data-role="assign-plan"');
  });
});
