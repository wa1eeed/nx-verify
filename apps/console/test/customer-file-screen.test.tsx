import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  CheckDefinition,
  CustomerFile,
  FileField,
  FileSection,
  ProfileSection,
} from '@nx-verify/core';
import {
  CustomerFileScreen,
  type CustomerFileView,
  type TimelineEntry,
} from '../src/components/customer-file';

/**
 * Handoff phase 3: the customer file of screen 03, rendered from a file whose every state is
 * chosen, so each rule of the screen is asserted rather than eyeballed.
 */

const OBSERVED = new Date('2026-09-12T11:08:00Z');

const check = (productCode: string, nameAr: string, section: ProfileSection): CheckDefinition => ({
  productCode,
  nameAr,
  nameEn: productCode,
  summaryAr: null,
  section,
  appliesTo: ['COMPANY'],
  order: 1,
  availability: 'AVAILABLE',
  requiredInputs: [],
  allowedInputs: [],
});

const field = (
  fieldPath: string,
  labelAr: string,
  value: unknown,
  authority: string,
): FileField => ({
  fieldPath,
  labelAr,
  value,
  valueLabelAr: null,
  authority,
  observedAt: OBSERVED,
  effectiveUntil: null,
  freshness: 'fresh',
  changed: false,
});

const section = (overrides: Partial<FileSection> & Pick<FileSection, 'section'>): FileSection => ({
  number: 1,
  titleAr: 'قسم',
  requirement: 'REQUIRED',
  sourceAr: 'مصدرها تحقق قسم',
  checks: [],
  fields: [],
  state: 'NOT_VERIFIED',
  issueAr: null,
  observedAt: null,
  authority: null,
  done: false,
  lastRun: null,
  ...overrides,
});

const CR = check('CR_FULL', 'السجل التجاري', 'REGISTRY');
const ADDRESS = check('NATIONAL_ADDRESS', 'العنوان الوطني', 'ADDRESS');
const IBAN = check('IBAN_VERIFICATION', 'الآيبان والحساب البنكي', 'BANKING');

function fileWith(sections: FileSection[]): CustomerFile {
  return {
    entityId: '6b7f4a0e-2d4c-4f5e-9a1b-0c3d2e1f4a5b',
    entityType: 'BUSINESS',
    displayName: 'شركة أفق المدى للتقنية',
    kind: 'COMPANY',
    kindLabelAr: 'شركة',
    createdAt: new Date('2026-03-02T08:00:00Z'),
    identifiers: [{ idType: 'CR', masked: '••••••4567', isPrimary: true }],
    primaryIdentifier: { labelAr: 'س.ت', masked: '••••••4567' },
    status: { textAr: 'فعال', tone: 'fresh' },
    sections,
    managers: [],
    partners: [],
    accounts: [],
    assessment: {
      mode: 'KYB',
      items: [
        {
          key: 'registry_active',
          labelAr: 'السجل التجاري فعّال',
          shortAr: 'سجل ساري',
          state: 'PASS',
          detailAr: null,
        },
        {
          key: 'bank_account',
          labelAr: 'الحساب البنكي يعود للعميل',
          shortAr: 'حساب مطابق',
          state: 'WARN',
          detailAr: 'تطابق جزئي بين الاسم واسم صاحب الحساب.',
        },
      ],
      passed: 1,
      applicable: 2,
      statusAr: 'موثّق جزئياً',
      statusTone: 'neutral',
      standing: 'COMPLETE',
      standingAr: 'مستوفى',
      riskLevel: 'MEDIUM',
      riskLabelAr: 'متوسطة',
      riskScore: 46,
      riskReasons: [
        {
          key: 'iban_partial',
          weight: 30,
          textAr: 'تطابق جزئي فقط بين اسم العميل واسم صاحب الحساب.',
        },
        { key: 'shared_address', weight: 16, textAr: 'العنوان الوطني نفسه مسجل باسم منشأة أخرى.' },
      ],
      signals: [],
    },
    intersections: [],
    lastVerifiedAt: OBSERVED,
    nextReviewAt: null,
    completeness: 80,
    sectionsDone: 4,
    sectionsRequired: 5,
    kyc: { verified: 2, total: 3, lineAr: 'مدير مفوّض واحد بانتظار التحقق' },
    openChanges: 0,
    checks: [CR, ADDRESS, IBAN],
    nameMatchThresholdPct: 85,
  };
}

const run = (index: number, triggeredBy: string): TimelineEntry => ({
  key: `run-${index}`,
  titleAr: `تحقق رقم ${index} · مكتمل`,
  tone: 'done',
  at: new Date(OBSERVED.getTime() - index * 60_000),
  reference: `VRF-2026-00000${index}`,
  triggerAr: triggeredBy,
  fields: [],
});

function render(
  file: CustomerFile,
  timeline: TimelineEntry[] = [],
  running: readonly string[] = [],
): string {
  const view: CustomerFileView = {
    file,
    bundles: { refreshAll: 'bundle-all', sections: {}, managers: {} },
    prices: { CR_FULL: 2000, NATIONAL_ADDRESS: 600, IBAN_VERIFICATION: 2000 },
    refusals: {},
    fromPackage: false,
    showPrices: true,
    results: null,
    running,
    error: null,
    histories: {},
    timeline,
    now: new Date('2026-09-14T09:00:00Z'),
  };
  return renderToStaticMarkup(
    <CustomerFileScreen
      view={view}
      action="/customers/verify"
      share={{ panel: null, open: false }}
    />,
  );
}

/** The markup outside every dialog, which is what is on the screen until one opens. */
function outsideDialogs(html: string): string {
  return html.replace(/<dialog[\s\S]*?<\/dialog>/g, '');
}

describe('the customer file of screen 03', () => {
  const sections = [
    section({
      section: 'REGISTRY',
      number: 1,
      titleAr: 'البيانات الأساسية',
      checks: [CR],
      fields: [field('cr.core.name', 'اسم المنشأة', 'شركة أفق المدى للتقنية', 'وزارة التجارة')],
      state: 'VERIFIED',
      observedAt: OBSERVED,
      authority: 'وزارة التجارة',
      done: true,
    }),
    section({
      section: 'ADDRESS',
      number: 2,
      titleAr: 'العنوان الوطني',
      checks: [ADDRESS],
      fields: [field('address.national.city', 'المدينة', 'الرياض', 'العنوان الوطني')],
      state: 'EXPIRED',
      observedAt: OBSERVED,
      authority: 'العنوان الوطني',
    }),
    section({
      section: 'BANKING',
      number: 3,
      titleAr: 'المعلومات المصرفية',
      checks: [IBAN],
      fields: [field('bank.name', 'البنك', 'البنك الأهلي السعودي', 'المدفوعات السعودية')],
      state: 'CONFLICT',
      issueAr: 'تعارض في الاسم',
      observedAt: OBSERVED,
      authority: 'المدفوعات السعودية',
      done: true,
    }),
  ];
  const html = render(fileWith(sections));

  it('heads the file with its name, its kind and its number, masked and left to right', () => {
    expect(html).toContain('<h1 class="page-title">شركة أفق المدى للتقنية</h1>');
    expect(html).toContain('data-role="classification">شركة</span>');
    expect(html).toContain('س.ت <bdi dir="ltr" class="ltr">••••4567</bdi>');
    expect(html).toContain('أُنشئ الملف في 2 مارس 2026 · آخر تحقق 12 سبتمبر 2026');
  });

  it('keeps one primary action in the head and one in a section whose facts conflict, and no more', () => {
    const visible = outsideDialogs(html);
    const primaries = visible.match(/class="btn btn-primary"/g) ?? [];
    expect(primaries).toHaveLength(2);
    expect(visible).toMatch(/data-role="refresh-all" type="button" class="btn btn-primary"/);
    const banking = /data-section="BANKING"[\s\S]*?<\/section>/.exec(visible)?.[0] ?? '';
    expect(banking).toContain('class="btn btn-primary"');
  });

  it('draws the four figures: completeness, standing, the people, and the risk score', () => {
    expect(html).toContain('class="completeness-ring"');
    expect(html).toContain('<bdi dir="ltr" class="ltr">80%</bdi>');
    expect(html).toContain(
      '<bdi dir="ltr" class="ltr">4</bdi> من <bdi dir="ltr" class="ltr">5</bdi> أقسام',
    );
    expect(html).toContain('data-role="standing">مستوفى</p>');
    expect(html).toContain(
      '<bdi dir="ltr" class="ltr">2</bdi> من <bdi dir="ltr" class="ltr">3</bdi>',
    );
    expect(html).toContain('متوسطة · <bdi dir="ltr" class="ltr">46</bdi>');
  });

  it('numbers the sections and tags each state as the handoff does, expired neutral and conflict accent', () => {
    expect(html).toMatch(
      /data-section="REGISTRY"[\s\S]*?class="file-section-number" data-done="yes"/,
    );
    expect(html).toContain(
      'class="tag tag-accent-2" data-role="section-state">مُتحقق · 12 سبتمبر</span>',
    );
    expect(html).toContain('class="tag tag-neutral" data-role="section-state">منتهي</span>');
    expect(html).toContain(
      'class="tag tag-accent" data-role="section-state">تعارض في الاسم</span>',
    );
  });

  it('names the source and the authority of every section, and keeps them on every fact', () => {
    expect(html).toContain('مصدرها تحقق قسم · وزارة التجارة');
    const facts = html.match(/data-field="[^"]+"/g) ?? [];
    const authorities = html.match(/data-role="authority"/g) ?? [];
    const observed = html.match(/data-role="observed-at"/g) ?? [];
    expect(authorities.length).toBeGreaterThanOrEqual(facts.length);
    expect(observed.length).toBeGreaterThanOrEqual(facts.length);
  });

  it('lists the weighted reasons behind the risk score', () => {
    expect(html).toContain('data-role="risk-reasons"');
    expect(html).toContain('<bdi dir="ltr" class="ltr">+30</bdi>');
    expect(html).toContain('<bdi dir="ltr" class="ltr">+16</bdi>');
  });

  it('binds the IBAN field in the body to the banking section button in its head', () => {
    const formId = /<form[^>]*id="(verify-banking-[^"]+)"/.exec(html)?.[1];
    expect(formId).toBeDefined();
    expect(html).toContain(`form="${formId}"`);
  });

  it('says a section cannot be verified for this kind of customer, and offers no button for it', () => {
    const freelancer = render(
      fileWith([
        section({
          section: 'ADDRESS',
          titleAr: 'العنوان الوطني',
          requirement: 'NOT_APPLICABLE',
          sourceAr: null,
          checks: [ADDRESS],
          state: 'NOT_APPLICABLE',
        }),
      ]),
    );
    const address = /data-section="ADDRESS"[\s\S]*?<\/section>/.exec(freelancer)?.[0] ?? '';
    expect(address).toContain('غير متاح لهذا النوع');
    expect(address).not.toContain('data-role="check-section"');
  });

  it('marks a section being checked in the background, and holds its button until it settles', () => {
    const busy = render(fileWith(sections), [], ['NATIONAL_ADDRESS']);
    const address = /data-section="ADDRESS"[\s\S]*?<\/section>/.exec(busy)?.[0] ?? '';
    expect(address).toContain('data-running="yes"');
    expect(address).toContain('data-role="section-state">قيد المعالجة</span>');
    const button = /<button[^>]*data-role="check-section"[^>]*>/.exec(address)?.[0] ?? '';
    expect(button).toContain('disabled=""');
    const registry = /data-section="REGISTRY"[\s\S]*?<\/section>/.exec(busy)?.[0] ?? '';
    expect(registry).not.toContain('قيد المعالجة');
  });

  it('says what started each verification, and folds the older ones away', () => {
    const timeline = [
      ...Array.from({ length: 7 }, (_, index) =>
        run(index + 1, index === 0 ? 'يدوي من الكونسول' : 'مراقبة دورية'),
      ),
      {
        key: 'created',
        titleAr: 'إنشاء الملف',
        tone: 'neutral' as const,
        at: new Date('2026-03-02T08:00:00Z'),
        reference: null,
        triggerAr: null,
        fields: [],
      },
    ];
    const withHistory = render(fileWith(sections), timeline);
    expect(withHistory).toContain('يدوي من الكونسول');
    expect(withHistory).toContain('<summary>عمليات أقدم (2)</summary>');
    expect(withHistory).toContain('إنشاء الملف');
  });
});
