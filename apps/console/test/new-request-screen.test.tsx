import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The screen asks the router to redraw the frame's balance once a request settles. A static
// render has no router, and draws nothing that would use it.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
}));

import { NewRequestScreen } from '../src/components/new-request';
import {
  availableCountAr,
  lookupLineAr,
  rowView,
  selectedCountAr,
  totalsOf,
  type LookupData,
  type NewRequestActions,
  type NewRequestView,
  type ProductData,
} from '../src/components/new-request/model';

/**
 * Handoff phase 4: «طلب تحقق جديد», screen 02.
 *
 * The rules of the screen, asserted on what it draws and on the pure decisions behind each
 * row: a product that does not apply is faded with an empty box and no button, one being
 * checked says so and waits, prices go when the subscriber hides them, the count reads in
 * Arabic, and «تحقق من الكل» stops, with a way to buy credit, when the balance cannot pay.
 */

const product = (
  overrides: Partial<ProductData> & Pick<ProductData, 'productCode'>,
): ProductData => ({
  nameAr: 'منتج',
  nameEn: 'Product',
  summaryAr: 'حقول',
  appliesTo: ['COMPANY', 'ESTABLISHMENT'],
  availability: 'AVAILABLE',
  unitPriceHalalas: 300,
  allowed: true,
  refusalAr: null,
  perManager: false,
  needsIban: false,
  needsCertificate: false,
  selectedByDefault: true,
  ...overrides,
});

const PRODUCTS: ProductData[] = [
  product({
    productCode: 'CR_FULL',
    nameAr: 'السجل التجاري',
    nameEn: 'Commercial Registry',
    summaryAr: 'الاسم، النشاط، الحالة، رأس المال، تواريخ الإصدار والانتهاء',
  }),
  product({
    productCode: 'ARTICLES_OF_ASSOCIATION',
    nameAr: 'عقد التأسيس',
    nameEn: 'Articles of Association',
    appliesTo: ['COMPANY'],
    unitPriceHalalas: 500,
  }),
  product({
    productCode: 'MANAGER_AUTHORITY',
    nameAr: 'المدراء المفوضون',
    nameEn: 'Authorized Managers',
    unitPriceHalalas: 400,
    perManager: true,
  }),
  product({
    productCode: 'FREELANCE_CERTIFICATE',
    nameAr: 'شهادة الفريلانسر',
    nameEn: 'Freelancer Certificate',
    appliesTo: ['FREELANCER'],
    unitPriceHalalas: 200,
    needsCertificate: true,
  }),
  product({
    productCode: 'IBAN_VERIFICATION',
    nameAr: 'الآيبان والحساب البنكي',
    nameEn: 'IBAN & Account',
    appliesTo: ['COMPANY', 'ESTABLISHMENT', 'FREELANCER'],
    unitPriceHalalas: 150,
    needsIban: true,
  }),
];

const FOUND: LookupData = {
  status: 'FOUND',
  entityId: '6b7f4a0e-2d4c-4f5e-9a1b-0c3d2e1f4a5b',
  displayName: 'شركة أفق المدى للتقنية',
  identifierMasked: '••••••4567',
  kind: 'COMPANY',
  accountMasked: '••••••••••••••••••••1309',
  managers: 3,
  hasCertificate: false,
  standings: [
    {
      productCode: 'CR_FULL',
      state: 'VERIFIED',
      verifiedAt: '2026-09-12T08:00:00.000Z',
      issueAr: null,
      hasResult: true,
    },
    {
      productCode: 'IBAN_VERIFICATION',
      state: 'CONFLICT',
      verifiedAt: '2026-09-12T08:00:00.000Z',
      issueAr: 'اسم غير مطابق',
      hasResult: true,
    },
  ],
};

const never = (): never => {
  throw new Error('not called in a static render');
};
const ACTIONS: NewRequestActions = {
  lookup: never,
  standings: never,
  submit: never,
  saveDraft: never,
  status: never,
  discardDraft: never,
};

function view(overrides: Partial<NewRequestView> = {}): NewRequestView {
  return {
    kind: 'COMPANY',
    products: PRODUCTS,
    showPrices: true,
    balance: { capacityRemaining: null, walletAvailableHalalas: 500_000 },
    bundle: '0b5c8f1e-3a4d-4e6f-9a7b-1c2d3e4f5a6b',
    lookup: FOUND,
    draft: null,
    drafts: [],
    samples: [],
    problemsAr: {
      NUMBER: 'تحقق من الرقم.',
      REGISTRATION_UNKNOWN: 'لا يوجد ملف بهذا السجل.',
      CERTIFICATE: 'رقم الشهادة غير صحيح.',
      IBAN: 'الآيبان غير صحيح.',
    },
    ...overrides,
  };
}

function render(overrides: Partial<NewRequestView> = {}): string {
  return renderToStaticMarkup(<NewRequestScreen view={view(overrides)} actions={ACTIONS} />);
}

function row(html: string, code: string): string {
  return new RegExp(`<li[^>]*data-product="${code}"[\\s\\S]*?</li>`).exec(html)?.[0] ?? '';
}

describe('the verification request of screen 02', () => {
  const html = render();

  it('says who the number belongs to, in the approved sentence', () => {
    expect(html).toContain('تم العثور على «شركة أفق المدى للتقنية»، سيُربط التحقق بملفها الحالي.');
    expect(html).toContain(
      '<label for="request-number">رقم السجل التجاري أو الهوية الوطنية</label>',
    );
    expect(html).toContain('role="radiogroup" aria-label="نوع الكيان"');
  });

  it('ticks everything that applies, and counts what is available for this kind', () => {
    expect(html).toContain('data-role="available-count">4 منتجات متاحة لنوع الكيان المحدد</p>');
    expect(html).toContain('data-role="selected-count">تم اختيار 4 منتجات</p>');
    const head = /<div class="request-products-head">[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
    expect(head).toMatch(
      /<input[^>]*checked=""[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*checked=""/,
    );
  });

  it('fades a product that does not apply, with its box empty and its button off', () => {
    const certificate = row(html, 'FREELANCE_CERTIFICATE');
    expect(certificate).toContain('data-applicable="no"');
    expect(certificate).toContain('data-role="product-state">غير مطبّق</span>');
    expect(certificate).toContain('Freelancer Certificate · غير متاح لنوع الكيان «شركة»');
    expect(certificate).not.toMatch(/checked=""/);
    const button = /<button[^>]*data-role="verify-product"[^>]*>/.exec(certificate)?.[0] ?? '';
    expect(button).toContain('disabled=""');
  });

  it('tags each row from the file: verified before with its day, a conflict in the accent', () => {
    const registry = row(html, 'CR_FULL');
    expect(registry).toContain(
      'class="tag tag-accent-2" data-role="product-state">مُتحقق سابقاً · 12 سبتمبر</span>',
    );
    expect(registry).toContain(
      'Commercial Registry · الاسم، النشاط، الحالة، رأس المال، تواريخ الإصدار والانتهاء',
    );
    expect(registry).toContain('>إعادة التحقق</button>');
    const iban = row(html, 'IBAN_VERIFICATION');
    expect(iban).toContain('class="tag tag-accent" data-role="product-state">اسم غير مطابق</span>');
    expect(row(html, 'ARTICLES_OF_ASSOCIATION')).toContain('>تحقق</button>');
  });

  it('shows each price left to right, and the total with what stays in the balance', () => {
    expect(row(html, 'CR_FULL')).toContain(
      'data-role="product-price"><bdi dir="ltr" class="ltr">3.00</bdi> ر.س</span>',
    );
    // A manager check is one operation for each of the three managers on file.
    expect(html).toContain(
      'data-role="total">الإجمالي 21.50 ر.س · سيُخصم من الرصيد ويبقى 4,978.50 ر.س</p>',
    );
  });

  it('keeps one primary action on the screen, «تحقق من الكل», wide and with its icon', () => {
    const primaries = html.match(/class="btn btn-primary[^"]*"/g) ?? [];
    expect(primaries).toEqual(['class="btn btn-primary btn-wide"']);
    const verifyAll = /<button[^>]*data-role="verify-all"[\s\S]*?<\/button>/.exec(html)?.[0] ?? '';
    expect(verifyAll).toContain('lucide-badge-check');
    expect(verifyAll).toContain('تحقق من الكل');
    expect(html).toContain('>حفظ كمسودة</button>');
  });

  it('hides every price when the subscriber hides them, and charges nothing less', () => {
    const hidden = render({ showPrices: false });
    expect(hidden).not.toContain('data-role="product-price"');
    expect(hidden).not.toContain('data-role="total"');
    expect(hidden).toContain('تم اختيار 4 منتجات');
  });

  it('stops «تحقق من الكل» when the balance cannot pay, and offers credit', () => {
    const empty = render({ balance: { capacityRemaining: 0, walletAvailableHalalas: 0 } });
    const verifyAll = /<button[^>]*data-role="verify-all"[^>]*>/.exec(empty)?.[0] ?? '';
    expect(verifyAll).toContain('disabled=""');
    expect(empty).toContain('data-role="balance-problem"');
    expect(empty).toMatch(/<a[^>]*href="\/billing"[^>]*>شراء رصيد<\/a>/);
  });

  it('reopens a draft with its number masked and nothing typed again', () => {
    const draft = render({
      lookup: null,
      draft: {
        requestId: '9d6e2c1b-8a7f-4e3d-b2c1-0f9e8d7c6b5a',
        kind: 'COMPANY',
        entityId: null,
        label: '••••••2184',
        subjectMasked: '••••••2184',
        productCodes: ['CR_FULL'],
        createdAt: '2026-09-13T08:00:00.000Z',
        ibanMasked: null,
        hasCertificate: false,
      },
    });
    expect(draft).toMatch(
      /<input[^>]*id="request-number"[^>]*readOnly=""[^>]*value="••••2184"|<input[^>]*id="request-number"[^>]*value="••••2184"[^>]*readOnly=""/,
    );
    expect(draft).toContain('مسودة محفوظة في 13 سبتمبر.');
    expect(draft).toContain('data-role="selected-count">تم اختيار منتج واحد</p>');
  });

  it('writes no em dash anywhere', () => {
    const emDash = String.fromCharCode(0x2014);
    expect(html).not.toContain(emDash);
    expect(render({ lookup: null })).not.toContain(emDash);
  });
});

describe('the decisions behind a row, a count and a total', () => {
  it('counts in the form Arabic gives each number', () => {
    expect(selectedCountAr(1)).toBe('تم اختيار منتج واحد');
    expect(selectedCountAr(2)).toBe('تم اختيار منتجين');
    expect(selectedCountAr(5)).toBe('تم اختيار 5 منتجات');
    expect(selectedCountAr(12)).toBe('تم اختيار 12 منتجاً');
    expect(availableCountAr(6)).toBe('6 منتجات متاحة لنوع الكيان المحدد');
    expect(availableCountAr(2)).toBe('منتجان متاحان لنوع الكيان المحدد');
  });

  it('pays from the package first, and says how many operations stay', () => {
    const selected = PRODUCTS.filter((entry) => entry.productCode !== 'FREELANCE_CERTIFICATE');
    const withPackage = totalsOf(selected, FOUND, {
      capacityRemaining: 1_841,
      walletAvailableHalalas: 0,
    });
    expect(withPackage.operations).toBe(6);
    expect(withPackage.affordable).toBe(true);
    expect(withPackage.lineAr).toBe('الإجمالي 21.50 ر.س · سيُخصم من الرصيد ويبقى 1,835 عملية');
    // Past the package, the wallet pays the rest, and can refuse.
    expect(
      totalsOf(selected, FOUND, { capacityRemaining: 2, walletAvailableHalalas: 100 }).affordable,
    ).toBe(false);
  });

  it('holds a row while its check runs, and says how a check from this screen ended', () => {
    const registry = PRODUCTS[0] as ProductData;
    const running = rowView(registry, {
      kind: 'COMPANY',
      standing: undefined,
      live: { productCode: 'CR_FULL', status: 'RUNNING', outcome: null, noteAr: null },
      result: undefined,
    });
    expect(running).toMatchObject({ enabled: false, running: true, tag: { text: 'قيد المعالجة' } });

    const failed = rowView(registry, {
      kind: 'COMPANY',
      standing: undefined,
      live: undefined,
      result: { status: 'FAILED', outcome: 'ERROR', noteAr: 'لم تُحتسب العملية.' },
    });
    expect(failed).toMatchObject({
      tag: { tone: 'neutral', text: 'فشل' },
      noteAr: 'لم تُحتسب العملية.',
    });

    const conflict = rowView(PRODUCTS[4] as ProductData, {
      kind: 'COMPANY',
      standing: FOUND.standings[1],
      live: undefined,
      result: { status: 'DONE', outcome: 'OK', noteAr: null },
    });
    expect(conflict.tag).toEqual({ tone: 'accent', text: 'اسم غير مطابق' });

    const done = rowView(registry, {
      kind: 'COMPANY',
      standing: FOUND.standings[0],
      live: undefined,
      result: { status: 'DONE', outcome: 'OK', noteAr: null },
    });
    expect(done.tag).toEqual({ tone: 'accent-2', text: 'مُتحقق' });
  });

  it('never reads the sentence about the last number as this one', () => {
    const invalid: LookupData = { ...FOUND, status: 'INVALID' };
    const problemsAr = view().problemsAr;
    expect(
      lookupLineAr(invalid, { searching: true, problemAr: null, draft: null, problemsAr }).textAr,
    ).toBe('جارٍ البحث عن ملف العميل…');
    expect(
      lookupLineAr(invalid, { searching: false, problemAr: null, draft: null, problemsAr }),
    ).toEqual({
      textAr: 'تحقق من الرقم.',
      problem: true,
    });
    expect(
      lookupLineAr(
        { ...FOUND, kind: 'FREELANCER', displayName: 'سالم' },
        {
          searching: false,
          problemAr: null,
          draft: null,
          problemsAr,
        },
      ).textAr,
    ).toBe('تم العثور على «سالم»، سيُربط التحقق بملفه الحالي.');
  });
});
