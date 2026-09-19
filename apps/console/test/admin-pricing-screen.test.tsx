import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { slicePage } from '@nx-verify/core';
import { AdminPricing, type AdminPricingView } from '../src/components/admin-pricing';
import {
  bundleTermsAr,
  daysField,
  lastChangeAr,
  noticeAr,
  parsePercent,
  parseRateFraction,
  parseRiyals,
  parseWholeNumber,
  planLinesAr,
  priceField,
  ratePctField,
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
  setPlanTerms: noop,
  setSpecialPrice: noop,
  setVat: noop,
};

/** The terms every plan carries, as the seed sets them, for the fixtures below. */
const PLAN_TERMS = {
  termMonths: 12,
  freeReverifyDays: 30,
  setupFeeHalalas: 0,
  commitmentCreditsHalalas: 0,
  overageAllowed: true,
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
        effectiveCostHalalas: 110,
        costVatBps: 1500,
        costKnown: true,
        providers: ['واثق'],
        priceHalalas: 300,
        priceWithVatHalalas: 300,
        rates: { negativePct: 0.5, cachePct: 1 },
        stepCount: 1,
        marginHalalas: 190,
        marginPct: 63,
        runs30: 8412,
        status: 'active',
        availability: 'AVAILABLE',
      },
      {
        productCode: 'NATIONAL_ADDRESS',
        nameAr: 'العنوان الوطني',
        costHalalas: 90,
        effectiveCostHalalas: 90,
        costVatBps: 1500,
        costKnown: true,
        providers: ['واثق'],
        priceHalalas: 110,
        priceWithVatHalalas: 110,
        rates: { negativePct: 0.25, cachePct: 0 },
        stepCount: 2,
        marginHalalas: 20,
        marginPct: 18,
        runs30: 6004,
        status: 'suspended',
        availability: 'AVAILABLE',
      },
      {
        productCode: 'PROPERTY_VERIFICATION',
        nameAr: 'التحقق من العقار',
        costHalalas: 500,
        effectiveCostHalalas: 500,
        costVatBps: 1500,
        costKnown: false,
        providers: [],
        priceHalalas: null,
        priceWithVatHalalas: null,
        rates: null,
        stepCount: 1,
        marginHalalas: null,
        marginPct: null,
        runs30: 0,
        status: 'active',
        availability: 'COMING_SOON',
      },
      {
        // On sale, and with no price at all: every run of it fails at resolvePrice.
        productCode: 'IBAN_VERIFICATION',
        nameAr: 'الآيبان',
        costHalalas: 80,
        effectiveCostHalalas: 80,
        costVatBps: 1500,
        costKnown: true,
        providers: ['واثق'],
        priceHalalas: null,
        priceWithVatHalalas: null,
        rates: null,
        stepCount: 1,
        marginHalalas: null,
        marginPct: null,
        runs30: 12,
        status: 'active',
        availability: 'AVAILABLE',
      },
    ],
    vat: { registered: false, ratePct: 15 },
    vatPeriods: [
      {
        effectiveFrom: '2020-07-01',
        registered: false,
        ratePct: '15',
        registrationNumber: null,
        note: null,
        setBy: 'migration',
        current: true,
        future: false,
      },
    ],
    today: '2026-09-18',
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
        validityMonths: 24,
        status: 'active',
        perOperationHalalas: 230,
        discountPct: 8,
      },
    ],
    definedBundles: [
      {
        code: 'BUNDLE_500',
        operations: 500,
        priceHalalas: 125_000,
        validityMonths: 12,
        retired: false,
      },
      {
        code: 'BUNDLE_2000',
        operations: 2000,
        priceHalalas: 460_000,
        validityMonths: 24,
        retired: false,
      },
      {
        code: 'BUNDLE_10000',
        operations: 10_000,
        priceHalalas: 2_100_000,
        validityMonths: 12,
        retired: true,
      },
    ],
    plans: [
      {
        code: 'STARTER',
        nameAr: 'البداية',
        billingModel: 'MONTHLY',
        monthlyFeeHalalas: 99_000,
        platformFeeHalalas: 99_000,
        includedTransactions: 300,
        overageUnitHalalas: 320,
        negotiated: false,
        ...PLAN_TERMS,
      },
      {
        code: 'ENTERPRISE',
        nameAr: 'المؤسسات',
        billingModel: 'ANNUAL',
        monthlyFeeHalalas: 0,
        platformFeeHalalas: 0,
        includedTransactions: null,
        overageUnitHalalas: null,
        negotiated: true,
        ...PLAN_TERMS,
        termMonths: 24,
        freeReverifyDays: 0,
        setupFeeHalalas: 500_000,
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
      userSecondStep: 'off' as const,
      registryAlertDays: 30,
      bankAccountName: 'شركة إن إكس',
      bankName: 'مصرف الراجحي',
      bankIban: 'SA0380000000608010167519',
      transferNote: null,
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
      'السعر بالريال بلا ضريبة لعملية ناجحة كاملة',
      'نتيجة «غير موجود» تُحسب بنسبتها أدناه، والفشل التقني والخطوة المتخطاة لا تُحسبان',
      'الهامش محسوب على عملية ناجحة كاملة',
      'المنتج',
      'التكلفة',
      'سعر البيع',
      'نسب الحالات الأخرى',
      'الهامش',
      'استهلاك 30 يوماً',
      'الحالة',
      'حزم الرصيد مسبقة الدفع',
      'تُشترى مرة واحدة وتُصرف على أي تحقق مهما كان سعره',
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

  it('shows the two rates that decide what an answer other than a plain success costs', () => {
    // Invisible and uneditable until now, and they charge a NOT_FOUND at half the price.
    expect(html).toMatch(/<input[^>]*name="negative:CR_FULL"[^>]*value="50"/);
    expect(html).toMatch(/<input[^>]*name="cached:CR_FULL"[^>]*value="100"/);
    expect(html).toMatch(/<input[^>]*name="negative:NATIONAL_ADDRESS"[^>]*value="25"/);
    expect(html).toMatch(/<input[^>]*name="cached:NATIONAL_ADDRESS"[^>]*value="0"/);
    expect(html).toContain('غير موجود');
    expect(html).toContain('نتيجة مخزّنة');
    // A check with no price has no row to carry them yet, and says so.
    expect(html).toContain('يُضبط مع أول سعر');
  });

  it('says a composite check shares its price between its steps', () => {
    expect(html).toContain('2 خطوات · يتقاسمن السعر بأوزانهن');
  });

  it('marks a check that is on sale with no price at all', () => {
    expect(html).toMatch(/data-role="no-price"[^>]*>بلا سعر · كل تشغيل يفشل/);
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

  it('says what one operation of a bundle costs, how long it lasts, and against what', () => {
    // The figure the whole model hangs on, computed and never shown until now, and a validity
    // per bundle rather than one line claiming the shortest one's.
    expect(html).toContain('سعر العملية 2.50 ر.س · صالحة 12 شهراً');
    expect(html).toContain('سعر العملية 2.30 ر.س · صالحة 24 شهراً');
    expect(html).toContain('أقل 8% من سعر العملية في أصغر حزمة');
  });

  it('says the terms of each plan, the free re-verification window first', () => {
    expect(html).toContain('التزام 12 شهراً · إعادة التحقق خلال 30 يوماً بلا رسم · بلا رسم تأسيس');
    expect(html).toContain('التزام 24 شهراً · كل إعادة تحقق تُحسب · رسم تأسيس 5,000 ر.س');
    expect(html).toContain('data-role="edit-plan"');
  });

  it('draws required sections in the accent and optional ones neutral, the registry fixed', () => {
    expect(html).toContain('المدراء · اختياري');
    expect(html).toContain('وثيقة العمل الحر');
    // A required section is the brand's green, not the attention colour (ADR-122).
    expect(html).toMatch(/<span class="tag tag-brand">السجل التجاري<\/span>/);
    expect(html).toContain('name="required:COMPANY"');
    expect(html).not.toContain('value="REGISTRY"');
  });

  it('lets a role that may only look change nothing', () => {
    const readOnly = render({ canEditPricing: false, canEditSettings: false });
    expect(readOnly).not.toContain('btn-primary');
    expect(readOnly).not.toContain('إضافة حزمة');
    expect(readOnly).not.toContain('name="on_sale"');
    expect(readOnly).not.toContain('data-role="edit-plan"');
    expect(readOnly).toContain('disabled=""');
    expect(readOnly).toContain('سجل التغييرات');
    // The rates are readable by a role that may not price, and not editable.
    expect(readOnly).toMatch(/<input[^>]*disabled=""[^>]*name="negative:CR_FULL"/);
  });

  it('says what a save did or why it was refused', () => {
    const refused = render({ notice: { tone: 'refused', text: 'لم تُحفظ التغييرات.' } });
    expect(refused).toContain('role="alert"');
    expect(refused).toContain('notice-refused');
  });

  it('has an empty state for a catalogue with nothing in it', () => {
    const empty = render({
      products: [],
      bundles: [],
      definedBundles: [],
      plans: [],
      specialPrices: [],
    });
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
    // A share of the price is a different figure: a hundred is a real answer, and a fraction
    // of a percent is not storable in a numeric(4,2) fraction, so it is refused not rounded.
    expect(parseRateFraction('50')).toBe(0.5);
    expect(parseRateFraction('١٠٠')).toBe(1);
    expect(parseRateFraction('0')).toBe(0);
    expect(parseRateFraction('101')).toBeNull();
    expect(parseRateFraction('12.5')).toBeNull();
    expect(parseRateFraction('')).toBeNull();
    expect(ratePctField(0.5)).toBe('50');
    expect(ratePctField(1)).toBe('100');
    expect(ratePctField(null)).toBe('');
    expect(daysField(90)).toBe('90 يوماً');
    expect(daysField(7)).toBe('7 أيام');
    expect(daysField(1)).toBe('1 يوم');
  });

  it('writes amounts, bundles and plans as the screen does', () => {
    expect(sar(125_000)).toBe('1,250 ر.س');
    expect(sar(125_050)).toBe('1,250.50 ر.س');
    expect(
      bundleTermsAr({
        code: 'BUNDLE_2000',
        operations: 2000,
        priceHalalas: 460_000,
        validityMonths: 24,
        status: 'active',
        perOperationHalalas: 230,
        discountPct: 8,
      }),
    ).toBe('سعر العملية 2.30 ر.س · صالحة 24 شهراً · أقل 8% من سعر العملية في أصغر حزمة');
    expect(
      planLinesAr({
        code: 'GROWTH',
        nameAr: 'النمو',
        billingModel: 'MONTHLY',
        monthlyFeeHalalas: 290_000,
        platformFeeHalalas: 290_000,
        includedTransactions: 1200,
        overageUnitHalalas: 260,
        negotiated: false,
        ...PLAN_TERMS,
        commitmentCreditsHalalas: 500_000,
      }),
    ).toEqual({
      price: '2,900 ر.س / شهر',
      terms: '1,200 عملية · تجاوز 2.60 ر.س',
      commitment:
        'التزام 12 شهراً · إعادة التحقق خلال 30 يوماً بلا رسم · بلا رسم تأسيس · رصيد عند التوقيع 5,000 ر.س',
    });
    // A plan that stops at its limit says so instead of naming a price nobody can reach.
    expect(
      planLinesAr({
        code: 'CAPPED',
        nameAr: 'المحدودة',
        billingModel: 'MONTHLY',
        monthlyFeeHalalas: 50_000,
        platformFeeHalalas: 50_000,
        includedTransactions: 100,
        overageUnitHalalas: 260,
        negotiated: false,
        ...PLAN_TERMS,
        overageAllowed: false,
      }).terms,
    ).toBe('100 عملية · يتوقف العمل عند الحد');
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

  it('names the checks whose price was removed, and refuses to remove one still on sale', () => {
    const names = new Map([['CR_FULL', 'السجل التجاري']]);
    const nameOf = (code: string): string => names.get(code) ?? code;
    expect(noticeAr({ saved: '1', cleared: 'CR_FULL' }, nameOf)).toEqual({
      tone: 'done',
      text: 'حُفظت التغييرات. أُلغي سعر: السجل التجاري.',
    });
    expect(noticeAr({ refused: 'clear-on-sale', product: 'CR_FULL' }, nameOf)?.text).toContain(
      'أوقف بيعه ثم امسح السعر',
    );
    expect(noticeAr({ refused: 'no-price', product: 'CR_FULL' }, nameOf)?.text).toContain(
      'لا يُعرض للبيع منتج بلا سعر',
    );
  });

  it('tells adding a bundle from replacing one, and says which happened', () => {
    const nameOf = (code: string): string => code;
    expect(noticeAr({ saved: 'bundle' }, nameOf)?.text).toBe('أُضيفت الحزمة.');
    expect(noticeAr({ saved: 'bundle-replaced' }, nameOf)?.text).toContain('اُستبدلت الحزمة');
    expect(noticeAr({ refused: 'bundle-exists' }, nameOf)?.text).toContain(
      'توجد حزمة بعدد العمليات نفسه',
    );
    // The way out it names has to exist. Beside a bundle there is one control and it takes
    // the bundle off sale; replacing a price is the add dialog with the count already taken.
    expect(noticeAr({ refused: 'bundle-exists' }, nameOf)?.text).toContain('واكتب العدد نفسه');
    expect(noticeAr({ refused: 'bundle-exists' }, nameOf)?.text).not.toContain('زر التعديل');
    expect(noticeAr({ saved: 'plan-terms' }, nameOf)?.text).toContain(
      'يسريان على المشتركين الحاليين',
    );
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

  it('says the changes the plans screen makes, which reached no panel trail at all', () => {
    expect(
      auditChangeAr({
        action: 'pricing.plan_product',
        metadata: { product: 'CR_FULL', enabled: true, monthly_quota: 200, price: 2400 },
      }),
    ).toBe('CR_FULL · مفعّل · حد شهري 200 · 24.00 ر.س');
    expect(
      auditChangeAr({
        action: 'pricing.tenant_exception',
        metadata: { product: 'CR_FULL', enabled: null },
      }),
    ).toBe('CR_FULL');
    expect(
      auditChangeAr({
        action: 'pricing.plan_terms',
        metadata: { free_reverify_days: 0, overage_allowed: false },
      }),
    ).toBe('إعادة التحقق المجانية 0 يوماً، يتوقف العمل عند الحد');
    expect(
      auditChangeAr({
        action: 'pricing.bundle_replaced',
        metadata: { price: 460_000, months: 24, from: 500_000, resumed: true },
      }),
    ).toBe('من 5,000.00 ر.س · 4,600.00 ر.س · 24 شهراً · وأُعيدت للبيع');
    // A rate that moved is a change to the bill, so the line says it beside the price.
    expect(
      auditChangeAr({
        action: 'pricing.list_price',
        metadata: { from: 300, to: 300, margin_pct: 50, negative_pct: 0.25 },
      }),
    ).toBe('من 3.00 إلى 3.00 · هامش 50% · غير موجود 25%');
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
        credentialVersion: 1,
        recoveryCodesLeft: 10,
        secondFactorAt: new Date('2026-09-01T00:10:00Z'),
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
