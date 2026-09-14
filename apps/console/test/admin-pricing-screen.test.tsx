import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { slicePage } from '@nx-verify/core';
import { AdminPricing, type AdminPricingView } from '../src/components/admin-pricing';
import {
  bundlesLineAr,
  daysField,
  lastChangeAr,
  noticeAr,
  parsePercent,
  parseRiyals,
  parseWholeNumber,
  planLinesAr,
  priceField,
  sar,
  specialLineAr,
} from '../src/components/admin-pricing/model';
import { AdminAccess, type AdminAccessView } from '../src/components/admin-access';
import { auditChangeAr, auditScopeOf, auditTargetAr } from '../src/components/admin-access/model';
import { balanceOf } from '../src/lib/balance';

/**
 * Handoff screen 05, the prices and settings of the administration panel, and the staff and
 * trail behind them (PLAN.md, decision 5).
 */

const EM_DASH = String.fromCharCode(0x2014);
const noop = async (): Promise<void> => undefined;
const actions = {
  save: noop,
  addBundle: noop,
  retireBundle: noop,
  addPlan: noop,
  setSpecialPrice: noop,
};

function view(overrides: Partial<AdminPricingView> = {}): AdminPricingView {
  return {
    canEditPricing: true,
    canEditSettings: true,
    lastChange: { byName: 'وليد الغامدي', at: new Date('2026-09-12T13:31:00Z') },
    notice: null,
    products: [
      {
        productCode: 'CR_FULL',
        nameAr: 'السجل التجاري',
        costHalalas: 110,
        priceHalalas: 300,
        marginPct: 63,
        runs30: 8412,
        status: 'active',
        availability: 'AVAILABLE',
      },
      {
        productCode: 'NATIONAL_ADDRESS',
        nameAr: 'العنوان الوطني',
        costHalalas: 90,
        priceHalalas: 110,
        marginPct: 18,
        runs30: 6004,
        status: 'suspended',
        availability: 'AVAILABLE',
      },
      {
        productCode: 'PROPERTY_VERIFICATION',
        nameAr: 'التحقق من العقار',
        costHalalas: 500,
        priceHalalas: null,
        marginPct: null,
        runs30: 0,
        status: 'active',
        availability: 'COMING_SOON',
      },
    ],
    bundles: [
      {
        code: 'BUNDLE_500',
        operations: 500,
        priceHalalas: 125_000,
        validityMonths: 12,
        status: 'active',
        perOperationHalalas: 250,
        discountPct: null,
      },
      {
        code: 'BUNDLE_2000',
        operations: 2000,
        priceHalalas: 460_000,
        validityMonths: 12,
        status: 'active',
        perOperationHalalas: 230,
        discountPct: 8,
      },
    ],
    plans: [
      {
        code: 'STARTER',
        nameAr: 'البداية',
        billingModel: 'MONTHLY',
        monthlyFeeHalalas: 99_000,
        includedTransactions: 300,
        overageUnitHalalas: 320,
        negotiated: false,
      },
      {
        code: 'ENTERPRISE',
        nameAr: 'المؤسسات',
        billingModel: 'ANNUAL',
        monthlyFeeHalalas: 0,
        includedTransactions: null,
        overageUnitHalalas: null,
        negotiated: true,
      },
    ],
    specialPrices: [
      {
        tenantId: '0b7c1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4',
        legalName: 'نُهج للحلول المالية',
        discountPct: null,
        products: [
          { productCode: 'CR_FULL', nameAr: 'السجل التجاري', priceHalalas: 240 },
          { productCode: 'IBAN_VERIFICATION', nameAr: 'الآيبان', priceHalalas: 110 },
        ],
      },
      {
        tenantId: '1c8d2e3f-4a5b-4c6d-9e7f-8091a2b3c4d5',
        legalName: 'بنك الرياض، قسم الائتمان',
        discountPct: 18,
        products: [],
      },
    ],
    settings: {
      maxAttempts: 2,
      resultValidityDays: 90,
      nameMatchThresholdPct: 85,
      registryAlertDays: 30,
    },
    sections: {
      COMPANY: [
        { section: 'REGISTRY', requirement: 'REQUIRED', fixed: true },
        { section: 'CONTRACT', requirement: 'REQUIRED', fixed: false },
        { section: 'MANAGERS', requirement: 'REQUIRED', fixed: false },
      ],
      ESTABLISHMENT: [
        { section: 'REGISTRY', requirement: 'REQUIRED', fixed: true },
        { section: 'MANAGERS', requirement: 'OPTIONAL', fixed: false },
      ],
      FREELANCER: [
        { section: 'FREELANCE', requirement: 'REQUIRED', fixed: false },
        { section: 'BANKING', requirement: 'REQUIRED', fixed: false },
      ],
    },
    subscribers: [{ tenantId: '0b7c1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4', legalName: 'نُهج' }],
    minimumMarginPct: 30,
    ...overrides,
  };
}

const render = (overrides: Partial<AdminPricingView> = {}): string =>
  renderToStaticMarkup(<AdminPricing view={view(overrides)} actions={actions} />);

describe('the prices screen (handoff screen 05)', () => {
  const html = render();

  it('says the approved words of the screen', () => {
    for (const text of [
      'الأسعار والمنتجات',
      'سجل التغييرات',
      'حفظ التغييرات',
      'سعر كل منتج تحقق',
      'السعر بالريال لكل عملية ناجحة · العمليات الفاشلة لا تُحسب',
      'المنتج',
      'التكلفة',
      'سعر البيع',
      'الهامش',
      'استهلاك 30 يوماً',
      'الحالة',
      'حزم الرصيد مسبقة الدفع',
      'تُشترى مرة واحدة ولا تنتهي قبل 12 شهراً',
      'إضافة حزمة',
      'الاشتراكات',
      'حد شهري للعمليات مع سعر تجاوز',
      'إضافة باقة',
      'أسعار خاصة لمشترك',
      'تتجاوز الأسعار العامة عند وجودها',
      'إضافة سعر خاص',
      'إعدادات التحقق',
      'عدد المحاولات عند الفشل',
      'مدة صلاحية نتيجة التحقق',
      'حد تطابق الاسم المقبول',
      'تنبيه انتهاء السجل قبل',
      'الأقسام المطلوبة · شركة',
      'الأقسام المطلوبة · مؤسسة',
      'الأقسام المطلوبة · عامل حر',
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain(EM_DASH);
  });

  it('names who changed the prices last, and when', () => {
    expect(html).toContain('آخر تعديل بواسطة وليد الغامدي · 12 سبتمبر 2026، 16:31');
  });

  it('has one primary button in its head, which saves the table and the settings', () => {
    const head = html.slice(0, html.indexOf('data-role="price-table"'));
    expect(head.match(/btn-primary/g)).toHaveLength(1);
    expect(head).toContain('id="pricing-form"');
    // The fields sit outside the head and belong to its form by id.
    expect(html).toMatch(/<input[^>]*form="pricing-form"[^>]*name="price:CR_FULL"/);
    expect(html).toMatch(/<input[^>]*form="pricing-form"[^>]*name="max_attempts"/);
  });

  it('shows cost, price, margin, use and whether each check is on sale', () => {
    expect(html).toContain('value="3.00"');
    expect(html).toContain('8,412');
    expect(html).toContain('63%');
    expect(html).toContain('مفعّل');
    expect(html).toContain('موقوف');
    expect(html).toContain('قريباً');
  });

  it('marks a margin under the minimum rather than hiding it', () => {
    expect(html).toMatch(/data-tone="thin"[^>]*>.*18%/s);
  });

  it('lists bundles with their discount, plans with their terms, and special prices', () => {
    expect(html).toContain('500 عملية');
    expect(html).toContain('1,250 ر.س');
    expect(html).toContain('−8%');
    expect(html).toContain('990 ر.س / شهر');
    expect(html).toContain('300 عملية · تجاوز 3.20 ر.س');
    expect(html).toContain('سعر تفاوضي');
    expect(html).toContain('حد مخصص · تجاوز مخصص');
    expect(html).toContain('السجل التجاري 2.40 · الآيبان 1.10');
    expect(html).toContain('خصم 18% على كل المنتجات');
  });

  it('draws required sections in the accent and optional ones neutral, the registry fixed', () => {
    expect(html).toContain('المدراء · اختياري');
    expect(html).toContain('شهادة الفريلانسر');
    expect(html).toMatch(/<span class="tag tag-accent">السجل التجاري<\/span>/);
    expect(html).toContain('name="required:COMPANY"');
    expect(html).not.toContain('value="REGISTRY"');
  });

  it('lets a role that may only look change nothing', () => {
    const readOnly = render({ canEditPricing: false, canEditSettings: false });
    expect(readOnly).not.toContain('btn-primary');
    expect(readOnly).not.toContain('إضافة حزمة');
    expect(readOnly).not.toContain('name="on_sale"');
    expect(readOnly).toContain('disabled=""');
    expect(readOnly).toContain('سجل التغييرات');
  });

  it('says what a save did or why it was refused', () => {
    const refused = render({ notice: { tone: 'refused', text: 'لم تُحفظ التغييرات.' } });
    expect(refused).toContain('role="alert"');
    expect(refused).toContain('notice-refused');
  });

  it('has an empty state for a catalogue with nothing in it', () => {
    const empty = render({ products: [], bundles: [], plans: [], specialPrices: [] });
    expect(empty).toContain('لا منتج تحقق في الكتالوج بعد.');
    expect(empty).toContain('لا حزمة معروضة للبيع.');
    expect(empty).toContain('لا باقة اشتراك بعد.');
    expect(empty).toContain('لا سعر خاص لأي مشترك.');
  });
});

describe('the words and figures of screen 05', () => {
  it('reads a price typed in riyals, in any digits, and refuses a guess', () => {
    expect(parseRiyals('3.00')).toBe(300);
    expect(parseRiyals('3')).toBe(300);
    expect(parseRiyals('3.5')).toBe(350);
    expect(parseRiyals('٣٫٥٠')).toBe(350);
    expect(parseRiyals('1,250')).toBe(125_000);
    expect(parseRiyals('3.005')).toBeNull();
    expect(parseRiyals('-3')).toBeNull();
    expect(parseRiyals('ثلاثة')).toBeNull();
    expect(priceField(300)).toBe('3.00');
    expect(priceField(null)).toBe('');
  });

  it('reads the figures of the settings from the words around them', () => {
    expect(parseWholeNumber('90 يوماً')).toBe(90);
    expect(parseWholeNumber('85%')).toBe(85);
    expect(parseWholeNumber('٣٠ يوماً')).toBe(30);
    expect(parseWholeNumber('يوماً')).toBeNull();
    expect(parsePercent('18%')).toBe(18);
    expect(parsePercent('12.5')).toBe(12.5);
    expect(parsePercent('100')).toBeNull();
    expect(daysField(90)).toBe('90 يوماً');
    expect(daysField(7)).toBe('7 أيام');
    expect(daysField(1)).toBe('1 يوم');
  });

  it('writes amounts, bundles and plans as the screen does', () => {
    expect(sar(125_000)).toBe('1,250 ر.س');
    expect(sar(125_050)).toBe('1,250.50 ر.س');
    expect(bundlesLineAr([])).toBe('تُشترى مرة واحدة ولا تنتهي قبل 12 شهراً');
    expect(
      planLinesAr({
        code: 'GROWTH',
        nameAr: 'النمو',
        billingModel: 'MONTHLY',
        monthlyFeeHalalas: 290_000,
        includedTransactions: 1200,
        overageUnitHalalas: 260,
        negotiated: false,
      }),
    ).toEqual({ price: '2,900 ر.س / شهر', terms: '1,200 عملية · تجاوز 2.60 ر.س' });
    expect(
      specialLineAr({
        tenantId: 't',
        legalName: 'منصة تمويلي',
        discountPct: null,
        products: [
          { productCode: 'NATIONAL_ADDRESS', nameAr: 'العنوان الوطني', priceHalalas: 180 },
        ],
      }),
    ).toBe('العنوان الوطني 1.80');
    expect(lastChangeAr(null)).toBe('لم يُعدَّل أي سعر أو إعداد بعد');
  });

  it('names the checks whose margin came out thin after a save', () => {
    const names = new Map([['CR_FULL', 'السجل التجاري']]);
    expect(noticeAr({ saved: '1', thin: 'CR_FULL' }, (code) => names.get(code) ?? code)).toEqual({
      tone: 'done',
      text: 'حُفظت التغييرات. الهامش أقل من 30% في: السجل التجاري.',
    });
    expect(
      noticeAr({ refused: 'under-cost', product: 'CR_FULL' }, (code) => names.get(code) ?? code)
        ?.text,
    ).toContain('سعر السجل التجاري أقل من تكلفته');
    expect(noticeAr({}, (code) => code)).toBeNull();
  });
});

describe('the staff and the trail (الصلاحيات والتدقيق)', () => {
  const names = {
    products: new Map([['CR_FULL', 'السجل التجاري']]),
    plans: new Map([['GROWTH', 'النمو']]),
    tenants: new Map([['t-1', 'نُهج للحلول المالية']]),
    staff: new Map([['s-1', 'سارة العتيبي']]),
  };

  it('says what each change was made to by name, and the connection by environment only', () => {
    expect(auditTargetAr('pricing:product:CR_FULL', names)).toBe('السجل التجاري');
    expect(auditTargetAr('pricing:bundle:BUNDLE_2000', names)).toBe('حزمة 2000 عملية');
    expect(auditTargetAr('pricing:tenant:t-1', names)).toBe('نُهج للحلول المالية');
    expect(auditTargetAr('staff:s-1', names)).toBe('سارة العتيبي');
    expect(auditTargetAr('settings:verification', names)).toBe('إعدادات التحقق');
    const connection = auditTargetAr('some-source/live', names);
    expect(connection).toBe('الربط · بيئة الإنتاج');
    expect(connection).not.toContain('some-source');
  });

  it('describes figures that changed, from and to', () => {
    expect(
      auditChangeAr({
        action: 'pricing.list_price',
        metadata: { from: 300, to: 350, margin_pct: 69 },
      }),
    ).toBe('من 3.00 إلى 3.50 · هامش 69%');
    expect(
      auditChangeAr({
        action: 'settings.updated',
        metadata: { maxAttempts: { from: 2, to: 3 } },
      }),
    ).toBe('عدد المحاولات: من 2 إلى 3');
    expect(auditChangeAr({ action: 'staff.updated', metadata: { role: 'SUPPORT' } })).toBe(
      'الدور: الدعم',
    );
    expect(auditScopeOf('pricing')).toBe('pricing');
    expect(auditScopeOf('anything')).toBe('all');
  });

  const accessView = (overrides: Partial<AdminAccessView> = {}): AdminAccessView => ({
    accounts: [
      {
        id: 's-1',
        email: 'sara@example.sa',
        displayName: 'سارة العتيبي',
        role: 'OWNER',
        status: 'ACTIVE',
        lastSignInAt: null,
        createdAt: new Date('2026-09-01T00:00:00Z'),
      },
    ],
    selfId: 's-1',
    canManageStaff: true,
    sessionHours: 8,
    audit: slicePage(
      [
        {
          at: new Date('2026-09-12T13:31:00Z'),
          operatorId: 's-1',
          operatorName: 'سارة العتيبي',
          byName: 'سارة العتيبي',
          action: 'pricing.list_price',
          target: 'pricing:product:CR_FULL',
          metadata: { from: 300, to: 350, margin_pct: 69 },
        },
      ],
      { page: 1, size: 25 },
    ),
    params: {},
    scope: 'all',
    names,
    notice: null,
    now: new Date('2026-09-14T09:00:00Z'),
    ...overrides,
  });

  it('lists the team with roles, lets an owner add and change members, and names every change', () => {
    const html = renderToStaticMarkup(
      <AdminAccess
        view={accessView()}
        actions={{ addStaff: noop, updateStaff: noop, changeOwnPassword: noop }}
      />,
    );
    expect(html).toContain('فريق الإدارة');
    expect(html).toContain('data-role="add-staff"');
    expect(html).toContain('data-role="edit-staff"');
    expect(html).toContain('لم يدخل بعد');
    expect(html).toContain('تعديل سعر منتج');
    expect(html).toContain('من 3.00 إلى 3.50');
    // A dialog's own submit button is the dialog's, not a second action in the head.
    const head = html
      .slice(0, html.indexOf('data-role="staff"'))
      .replace(/<dialog[\s\S]*?<\/dialog>/g, '');
    expect(head.match(/<button[^>]*btn-primary/g)).toHaveLength(1);
    expect(html).not.toContain(EM_DASH);
  });

  it('offers a member who is not an owner no way to change the team', () => {
    const html = renderToStaticMarkup(
      <AdminAccess
        view={accessView({ canManageStaff: false })}
        actions={{ addStaff: noop, updateStaff: noop, changeOwnPassword: noop }}
      />,
    );
    expect(html).not.toContain('data-role="add-staff"');
    expect(html).not.toContain('data-role="edit-staff"');
    expect(html).toContain('data-role="own-password"');
  });
});

describe('the balance at the foot of the sidebar', () => {
  it('counts the package and the bundles as one figure of operations', () => {
    expect(
      balanceOf(
        { includedTransactions: 300, transactionsUsed: 100 },
        { operations: 400, granted: 500 },
        0,
      ),
    ).toEqual({ kind: 'operations', included: 800, remaining: 600 });
  });

  it('counts bundles alone when there is no package, and riyals when there are neither', () => {
    expect(balanceOf(null, { operations: 20, granted: 500 }, 9_900)).toEqual({
      kind: 'operations',
      included: 500,
      remaining: 20,
    });
    expect(balanceOf(null, { operations: 0, granted: 0 }, 9_900)).toEqual({
      kind: 'wallet',
      availableHalalas: 9_900,
    });
  });
});
