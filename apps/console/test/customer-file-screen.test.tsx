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
    identifiers: [{ idType: 'CR', masked: '••••••4567', display: '1010234567', isPrimary: true }],
    primaryIdentifier: { labelAr: 'س.ت', masked: '••••••4567', display: '1010234567' },
    status: { textAr: 'فعال', tone: 'fresh' },
    sections,
    managers: [],
    partners: [],
    liquidators: [],
    accounts: [],
    mainRegistry: null,
    branches: [],
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

  it('heads the file with its name, its kind and its registry number in full, left to right', () => {
    expect(html).toContain('<h1 class="page-title">شركة أفق المدى للتقنية</h1>');
    expect(html).toContain('data-role="classification">شركة</span>');
    // A business's registry number is a public record, shown in full (ADR-127).
    expect(html).toContain('س.ت <bdi dir="ltr" class="ltr">1010234567</bdi>');
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

describe("every field an answer carries, on the file (the owner's ask)", () => {
  const OBSERVED_AT = OBSERVED;
  const dated = (
    overrides: Partial<FileField> & Pick<FileField, 'fieldPath' | 'labelAr' | 'value'>,
  ): FileField => ({
    ...field(overrides.fieldPath, overrides.labelAr, overrides.value, 'وزارة التجارة'),
    observedAt: OBSERVED_AT,
    ...overrides,
  });

  const registry = section({
    section: 'REGISTRY',
    number: 1,
    titleAr: 'البيانات الأساسية',
    checks: [CR],
    state: 'VERIFIED',
    observedAt: OBSERVED,
    authority: 'وزارة التجارة',
    done: true,
    identifiers: [
      { idType: 'CR', labelAr: 'رقم السجل التجاري', display: '1010234567' },
      { idType: 'UNN', labelAr: 'الرقم الوطني الموحد', display: '7001234567' },
    ],
    fields: [
      dated({
        fieldPath: 'cr.core.name',
        labelAr: 'اسم المنشأة',
        value: 'شركة أفق المدى للتقنية',
        part: 'registration',
      }),
      dated({
        fieldPath: 'cr.issue_date',
        labelAr: 'تاريخ إصدار السجل',
        value: '2002-10-05',
        part: 'dates',
        format: 'date',
        companions: [
          dated({
            fieldPath: 'cr.issue_date_hijri',
            labelAr: 'تاريخ إصدار السجل (هجري)',
            value: '1423-07-28',
            part: 'dates',
            format: 'hijri',
          }),
        ],
      }),
      dated({
        fieldPath: 'cr.core.capital',
        labelAr: 'رأس المال',
        value: 150000,
        part: 'capital',
        format: 'money',
      }),
      dated({
        fieldPath: 'cr.stocks',
        labelAr: 'فئات الأسهم',
        value: [{ class_name: 'عادية', count: 11, value: 12 }],
        part: 'capital',
        format: 'records',
        columns: [
          { key: 'class_name', labelAr: 'الفئة' },
          { key: 'type', labelAr: 'النوع' },
          { key: 'count', labelAr: 'عدد الأسهم', format: 'code' },
          { key: 'value', labelAr: 'القيمة الاسمية', format: 'money' },
        ],
      }),
      dated({
        fieldPath: 'cr.contact.email',
        labelAr: 'البريد الإلكتروني',
        value: 'info@example.sa',
        part: 'contact',
        format: 'email',
      }),
      dated({
        fieldPath: 'cr.website',
        labelAr: 'الموقع الإلكتروني',
        value: 'www.example.sa',
        part: 'contact',
        format: 'url',
      }),
      dated({
        fieldPath: 'cr.fiscal_year_end',
        labelAr: 'نهاية السنة المالية',
        value: '12-30',
        part: 'fiscal',
        format: 'month_day',
        companions: [
          dated({
            fieldPath: 'cr.fiscal_year.calendar',
            labelAr: 'تقويم السنة المالية',
            value: 'هجري',
            part: 'fiscal',
          }),
        ],
      }),
      dated({
        fieldPath: 'cr.in_liquidation',
        labelAr: 'تحت التصفية',
        value: true,
        valueLabelAr: 'نعم',
        part: 'liquidation',
      }),
    ],
  });
  const contract = section({
    section: 'CONTRACT',
    number: 2,
    titleAr: 'عقد التأسيس والملكية',
    state: 'VERIFIED',
    observedAt: OBSERVED,
    authority: 'وزارة التجارة',
    done: true,
    fields: [
      dated({
        fieldPath: 'contract.copy_number',
        labelAr: 'رقم نسخة العقد',
        value: 1,
        part: 'contract',
        format: 'code',
      }),
      dated({
        fieldPath: 'contract.articles',
        labelAr: 'نصوص مواد العقد',
        value: [
          { part: 'الباب الأول', text: 'تعمل الشركة وفقاً لنظام التجارة السعودي' },
          {
            part: 'الباب الثاني',
            title: 'شرط عدم المنافسة',
            text: 'لا يجوز للشركاء ممارسة أعمال منافسة',
          },
        ],
        part: 'articles',
        format: 'articles',
      }),
    ],
  });
  const address = section({
    section: 'ADDRESS',
    number: 3,
    titleAr: 'العنوان الوطني',
    state: 'VERIFIED',
    observedAt: OBSERVED,
    authority: 'العنوان الوطني',
    done: true,
    fields: [
      {
        ...field('address.national.latitude', 'الموقع على الخريطة', 24.75014397, 'العنوان الوطني'),
        part: 'address',
        format: 'coordinates',
        companions: [
          field('address.national.longitude', 'خط الطول', 46.72224397, 'العنوان الوطني'),
        ],
      },
      {
        ...field(
          'address.national.others',
          'العناوين الأخرى المسجلة',
          [
            {
              title: 'فرع',
              line1: '3120 طريق',
              line2: 'الرياض',
              building_number: '3120',
              additional_number: '7811',
              status: 'نشط',
            },
          ],
          'العنوان الوطني',
        ),
        part: 'other_addresses',
        format: 'records',
        columns: [
          { key: 'title', labelAr: 'الاسم' },
          { key: 'line1', labelAr: 'العنوان' },
          { key: 'line2', labelAr: 'تتمة العنوان' },
          { key: 'building_number', labelAr: 'المبنى', format: 'code' },
          { key: 'additional_number', labelAr: 'الرقم الإضافي', format: 'code' },
          { key: 'status', labelAr: 'الحالة' },
        ],
      },
    ],
  });

  const file: CustomerFile = {
    ...fileWith([
      registry,
      contract,
      section({
        section: 'MANAGERS',
        number: 3,
        titleAr: 'المدراء المفوضون',
        state: 'PARTIAL',
        issueAr: '1 من 1',
      }),
      address,
    ]),
    managers: [
      {
        entityId: '11111111-2222-4333-8444-555555555555',
        name: 'محمد أحمد علي',
        identifier: { idType: 'IQAMA', labelAr: 'إقامة', display: '2123456789' },
        checkable: true,
        nationality: 'مصري',
        managerType: 'مقيم',
        licensed: true,
        positions: ['مدير تنفيذي'],
        permissions: [
          {
            name: 'توقيع العقود',
            method: 'مجتمعين',
            canIssuePoa: false,
            canDelegate: true,
            condition: null,
          },
        ],
        permissionsCheckedAt: OBSERVED,
        observedAt: OBSERVED,
        alsoManages: [],
        isCustomer: false,
      },
      {
        entityId: '11111111-2222-4333-8444-666666666666',
        name: 'John Smith',
        identifier: { idType: 'PARTY_ID', labelAr: 'جواز سفر', display: 'A1234567' },
        checkable: false,
        nationality: 'بريطاني',
        managerType: null,
        licensed: null,
        positions: ['عضو'],
        permissions: null,
        permissionsCheckedAt: null,
        observedAt: OBSERVED,
        alsoManages: [],
        isCustomer: false,
      },
    ],
    partners: [
      {
        entityId: '22222222-2222-4333-8444-555555555555',
        name: 'وقف',
        kind: 'BUSINESS',
        identifier: { idType: 'PARTY_ID', labelAr: 'رقم صك الوقف', display: '7111111111' },
        partyType: 'وقف',
        nationality: null,
        roles: ['مؤسس'],
        shares: 500,
        cashShares: 250,
        inKindShares: 250,
        profitPct: 40,
        lossPct: 40,
        licenseNumber: null,
        guardian: null,
        alsoOwns: [],
        hasOwnFile: false,
      },
    ],
    liquidators: [
      {
        entityId: '33333333-2222-4333-8444-555555555555',
        name: 'عبدالله سالم هليل الشمري',
        kind: 'PERSON',
        identifier: { idType: 'IQAMA', labelAr: 'إقامة', display: '2345678901' },
        nationality: 'سعودي',
        liquidatorType: 'فرد سعودي',
        positions: ['عضو'],
      },
    ],
  };
  const html = render(file);
  const part = (name: string): string =>
    new RegExp(`data-part="${name}"[\\s\\S]*?(?=data-part="|</section>)`).exec(html)?.[0] ?? '';

  it('reads a long section in parts under headings, its numbers in full leading the first', () => {
    expect(html).toContain('<h3 class="file-part-title">بيانات السجل</h3>');
    expect(html).toContain('<h3 class="file-part-title">التواريخ</h3>');
    expect(html).toContain('<h3 class="file-part-title">رأس المال</h3>');
    const registration = part('registration');
    expect(registration).toContain('data-identifier="CR"');
    expect(registration).toContain('<dt>رقم السجل التجاري</dt>');
    expect(registration).toContain('<bdi dir="ltr" class="ltr">1010234567</bdi>');
    expect(registration).toContain('<bdi dir="ltr" class="ltr">7001234567</bdi>');
  });

  it('reads a date with its Hijri day under it, riyals in words, and the fiscal year by its months', () => {
    expect(html).toContain('الموافق <bdi dir="ltr" class="ltr">1423-07-28</bdi> هـ');
    expect(html).toContain('<bdi dir="ltr" class="ltr">150,000</bdi> ريال');
    expect(html).toContain('<bdi dir="ltr" class="ltr">30</bdi> ذو الحجة · هجري');
  });

  it('opens a web address and an email as links, never as anything that runs', () => {
    expect(html).toContain(
      'href="https://www.example.sa" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).toContain('href="mailto:info@example.sa"');
  });

  it('draws a short list of records as a table without the columns nobody filled', () => {
    const capital = part('capital');
    expect(capital).toContain('<th scope="col">الفئة</th>');
    expect(capital).not.toContain('<th scope="col">النوع</th>');
    expect(capital).toContain('<bdi dir="ltr" class="ltr">12</bdi> ريال');
  });

  it('draws a wide list of records as cards, one address at a time', () => {
    const others = part('other_addresses');
    expect(others).toContain('class="file-records file-record-cards"');
    expect(others).toContain('<dt>الرقم الإضافي</dt>');
    expect(others).not.toContain('<table');
  });

  it('folds the articles of association by their part, each with its count', () => {
    expect(html).toContain('<summary>الباب الأول · مادة واحدة</summary>');
    expect(html).toContain('<strong class="file-articles-title">شرط عدم المنافسة</strong>');
  });

  it('places coordinates on a map', () => {
    expect(html).toContain('<bdi dir="ltr" class="ltr">24.75014397, 46.72224397</bdi>');
    expect(html).toContain('href="https://www.google.com/maps?q=24.75014397%2C46.72224397"');
  });

  it('lists the liquidators with their identity in full', () => {
    const liquidation = part('liquidation');
    expect(liquidation).toContain('data-role="liquidator"');
    expect(liquidation).toContain('<bdi dir="ltr" class="ltr">2345678901</bdi>');
    expect(liquidation).toContain('فرد سعودي');
  });

  it('shows every manager with nationality, type, licence and the full powers', () => {
    expect(html).toContain('مصري · مقيم');
    expect(html).toContain('مدير مرخّص');
    expect(html).toContain(
      '<strong>توقيع العقود</strong> · مجتمعين · يصدر توكيلاً: لا · يفوّض غيره: نعم',
    );
    // A manager named by a passport is listed, and never waits for a check that cannot run.
    expect(html).toContain('جواز سفر</span> <bdi dir="ltr" class="ltr">A1234567</bdi>');
    expect(html).toContain('لا يتوفر تحقق لهذه الهوية');
  });

  it('shows a partner with its document, role, both kinds of shares, and profits and losses', () => {
    expect(html).toContain('رقم صك الوقف</span> <bdi dir="ltr" class="ltr">7111111111</bdi>');
    expect(html).toContain('الصفة: مؤسس');
    expect(html).toContain(
      'نقدية <bdi dir="ltr" class="ltr">250</bdi> · عينية <bdi dir="ltr" class="ltr">250</bdi>',
    );
    expect(html).toContain('الأرباح <bdi dir="ltr" class="ltr">40%</bdi>');
    expect(html).toContain('الخسائر <bdi dir="ltr" class="ltr">40%</bdi>');
  });
});
