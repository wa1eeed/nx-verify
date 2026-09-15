import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  slicePage,
  type CustomerFile,
  type FileSection,
  type PartyRoles,
  type RelatedPartySummary,
} from '@nx-verify/core';
import { Parties, partiesCountAr, rolesLineAr, type PartiesView } from '../src/components/parties';
import { PartyFileScreen, type PartyFileView } from '../src/components/customer-file/party';

/**
 * The related parties (the owner's ask): the list of whoever the customers name, and the file
 * of one of them, shaped for a person rather than for a company.
 */

const COMPANY_A = '11111111-2222-4333-8444-000000000001';
const COMPANY_B = '11111111-2222-4333-8444-000000000002';
const PERSON = '11111111-2222-4333-8444-000000000010';
const OBSERVED = new Date('2026-09-15T06:12:00Z');

let errors: string[] = [];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const party = (overrides: Partial<RelatedPartySummary> = {}): RelatedPartySummary => ({
  entityId: PERSON,
  entityType: 'PERSON',
  displayName: 'عبدالعزيز أحمد الثنيان',
  identifier: { idType: 'NATIONAL_ID', labelAr: 'هوية', display: '1234567890' },
  nationality: 'سعودي',
  companies: [
    {
      entityId: COMPANY_A,
      name: 'شركة اختبار للتجارة',
      entityType: 'BUSINESS',
      roles: ['MANAGER', 'PARTNER'],
      standing: 'ACTIVE',
      statusText: 'فعال',
      kind: 'COMPANY',
    },
    {
      entityId: COMPANY_B,
      name: 'شركة اختبار تحت التصفية',
      entityType: 'BUSINESS',
      roles: ['MANAGER'],
      standing: 'LIQUIDATION',
      statusText: 'تحت التصفية',
      kind: 'COMPANY',
    },
  ],
  roleCounts: { MANAGER: 2, PARTNER: 1, LIQUIDATOR: 0, GUARDIAN: 0 },
  authority: { verified: 1, checkable: 2 },
  isCustomer: false,
  concerns: 1,
  lastSeenAt: OBSERVED,
  ...overrides,
});

function listView(rows: RelatedPartySummary[], overrides: Partial<PartiesView> = {}): PartiesView {
  return {
    page: slicePage(rows, { page: 1, size: 25 }),
    params: {},
    counts: {
      all: rows.length,
      MANAGER: 1,
      PARTNER: 1,
      LIQUIDATOR: 1,
      GUARDIAN: 0,
      concerns: 1,
      several: 1,
    },
    filter: 'all',
    concernsOnly: false,
    severalOnly: false,
    search: '',
    searchedByNumber: false,
    searchAction: '/customers/parties/search',
    ...overrides,
  };
}

describe('the related parties list', () => {
  const endowment = party({
    entityId: '11111111-2222-4333-8444-000000000011',
    entityType: 'BUSINESS',
    displayName: 'وقف',
    identifier: { idType: 'PARTY_ID', labelAr: 'رقم صك الوقف', display: '7111111111' },
    nationality: null,
    roleCounts: { MANAGER: 0, PARTNER: 2, LIQUIDATOR: 0, GUARDIAN: 0 },
    authority: { verified: 0, checkable: 0 },
    concerns: 0,
  });
  const html = renderToStaticMarkup(<Parties view={listView([party(), endowment])} />);

  it('counts the parties in the words Arabic gives the number', () => {
    expect(partiesCountAr(1)).toBe('طرف واحد');
    expect(partiesCountAr(2)).toBe('طرفان');
    expect(partiesCountAr(5)).toBe('5 أطراف');
    expect(partiesCountAr(11)).toBe('11 طرفاً');
    expect(html).toContain('طرفان يظهرون داخل ملفات عملائك');
  });

  it('shows each party with the number in full, the roles and where they hold them', () => {
    expect(html).toContain('هوية</span> <bdi dir="ltr" class="ltr">1234567890</bdi>');
    expect(html).toContain('رقم صك الوقف</span> <bdi dir="ltr" class="ltr">7111111111</bdi>');
    expect(rolesLineAr({ MANAGER: 2, PARTNER: 1, LIQUIDATOR: 0, GUARDIAN: 0 })).toBe(
      'مدير في 2 · شريك في 1',
    );
    expect(html).toContain('data-role="party-roles">مدير في 2 · شريك في 1</td>');
    expect(html).toContain(`href="/customers/${COMPANY_A}"`);
    expect(html).toContain('منشأة بحاجة لنظر');
  });

  it('says how much of the authority of a manager is proven, and opens the file of a party', () => {
    expect(html).toContain('مثبتة في <bdi dir="ltr" class="ltr">1</bdi> من');
    expect(html).toContain(`data-href="/customers/${PERSON}"`);
    // An organisation is a party too, with no authority to prove.
    expect(html).toContain('>جهة</span>');
  });

  it('filters by role and posts its search so a number never reaches an address', () => {
    expect(html).toContain('href="/customers/parties?role=MANAGER"');
    expect(html).toContain('href="/customers/parties?several=1"');
    expect(html).toContain('href="/customers/parties?concerns=1"');
    expect(html).toContain('action="/customers/parties/search"');
  });

  it('says so when nobody is named yet', () => {
    const empty = renderToStaticMarkup(<Parties view={listView([])} />);
    expect(empty).toContain('لا أطراف بعد');
  });

  it('renders without a warning', () => {
    renderToStaticMarkup(<Parties view={listView([party()])} />);
    expect(errors).toEqual([]);
  });
});

const basics: FileSection = {
  section: 'REGISTRY',
  number: 1,
  titleAr: 'البيانات الأساسية',
  requirement: 'REQUIRED',
  sourceAr: null,
  checks: [],
  fields: [
    {
      fieldPath: 'person.name',
      labelAr: 'الاسم',
      value: 'عبدالعزيز أحمد الثنيان',
      valueLabelAr: null,
      authority: 'وزارة التجارة',
      observedAt: OBSERVED,
      effectiveUntil: null,
      freshness: 'fresh',
      changed: false,
      part: 'person',
    },
  ],
  state: 'VERIFIED',
  issueAr: null,
  observedAt: OBSERVED,
  authority: 'وزارة التجارة',
  done: true,
  lastRun: null,
  identifiers: [{ idType: 'NATIONAL_ID', labelAr: 'رقم الهوية الوطنية', display: '1234567890' }],
};

const file: CustomerFile = {
  entityId: PERSON,
  entityType: 'PERSON',
  displayName: 'عبدالعزيز أحمد الثنيان',
  kind: null,
  kindLabelAr: 'طرف ذو علاقة',
  createdAt: new Date('2026-09-14T03:13:00Z'),
  identifiers: [
    { idType: 'NATIONAL_ID', masked: '••••••7890', display: '1234567890', isPrimary: false },
  ],
  primaryIdentifier: { labelAr: 'هوية', masked: '••••••7890', display: '1234567890' },
  status: { textAr: null, tone: 'neutral' },
  sections: [basics],
  managers: [],
  partners: [],
  liquidators: [],
  accounts: [],
  mainRegistry: null,
  branches: [],
  assessment: {
    mode: 'KYB',
    items: [],
    passed: 0,
    applicable: 0,
    statusAr: '',
    statusTone: 'neutral',
    standing: 'IN_PROGRESS',
    standingAr: 'قيد الإكمال',
    riskLevel: 'INCOMPLETE',
    riskLabelAr: 'غير مكتمل',
    riskScore: null,
    riskReasons: [],
    signals: [],
  },
  intersections: [],
  lastVerifiedAt: OBSERVED,
  nextReviewAt: null,
  completeness: 0,
  sectionsDone: 0,
  sectionsRequired: 0,
  kyc: { verified: 0, total: 0, lineAr: '' },
  openChanges: 0,
  checks: [],
  nameMatchThresholdPct: 85,
};

const companies = party().companies;
const roles: PartyRoles = {
  companies,
  roleCounts: { MANAGER: 2, PARTNER: 1, LIQUIDATOR: 0, GUARDIAN: 0 },
  authority: { verified: 1, checkable: 2 },
  roles: [
    {
      company: companies[0] as (typeof companies)[number],
      role: 'MANAGER',
      positions: ['مدير تنفيذي'],
      typeText: 'سعودي',
      licensed: true,
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
      partnerRoles: [],
      shares: null,
      cashShares: null,
      inKindShares: null,
      profitPct: null,
      lossPct: null,
      licenseNumber: null,
      ward: null,
      isFather: null,
      observedAt: OBSERVED,
      checkable: true,
    },
    {
      company: companies[0] as (typeof companies)[number],
      role: 'PARTNER',
      positions: [],
      typeText: 'شخص ذو صفة طبيعية',
      licensed: null,
      permissions: null,
      permissionsCheckedAt: null,
      partnerRoles: ['مؤسس'],
      shares: 500,
      cashShares: 250,
      inKindShares: 250,
      profitPct: 50,
      lossPct: 50,
      licenseNumber: null,
      ward: null,
      isFather: null,
      observedAt: OBSERVED,
      checkable: false,
    },
    {
      company: companies[1] as (typeof companies)[number],
      role: 'MANAGER',
      positions: ['عضو'],
      typeText: null,
      licensed: null,
      permissions: null,
      permissionsCheckedAt: null,
      partnerRoles: [],
      shares: null,
      cashShares: null,
      inKindShares: null,
      profitPct: null,
      lossPct: null,
      licenseNumber: null,
      ward: null,
      isFather: null,
      observedAt: OBSERVED,
      checkable: true,
    },
  ],
  concerns: [
    {
      textAr: 'مرتبط بمنشأة تحت التصفية',
      entities: [{ entityId: COMPANY_B, name: 'شركة اختبار تحت التصفية', entityType: 'BUSINESS' }],
    },
  ],
};

function partyFile(overrides: Partial<PartyFileView> = {}): string {
  const view: PartyFileView = {
    file,
    roles,
    histories: {},
    refusals: {},
    running: {},
    bundles: { [COMPANY_A]: 'bundle-a', [COMPANY_B]: 'bundle-b' },
    timeline: [],
    now: OBSERVED,
    ...overrides,
  };
  return renderToStaticMarkup(
    <PartyFileScreen
      view={view}
      action="/customers/verify"
      sectionAction={async (state) => state}
    />,
  );
}

describe('the file of a related party', () => {
  const html = partyFile();

  it('heads the file as a related party, with the identity number in full', () => {
    expect(html).toContain('data-role="classification">طرف ذو علاقة</span>');
    expect(html).toContain('هوية <bdi dir="ltr" class="ltr">1234567890</bdi>');
    expect(html).toContain('data-file="party"');
  });

  it('draws no company indicators, and figures shaped for a person instead', () => {
    expect(html).not.toContain('data-role="kyb-indicators"');
    expect(html).not.toContain('مؤشرات KYB');
    expect(html).toContain('المنشآت المرتبطة');
    expect(html).toContain('الصلاحيات المثبتة');
    expect(html).toContain('ما يستحق النظر');
  });

  it('lists each company once with every role held in it and its standing', () => {
    const rows = html.match(/data-role="party-company-row"/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(html).toContain('data-roles="MANAGER PARTNER"');
    expect(html).toContain('data-role="company-standing">تحت التصفية</span>');
    expect(html).toContain('الصفة: مؤسس');
    expect(html).toContain('الأرباح <bdi dir="ltr" class="ltr">50%</bdi>');
    expect(html).toContain(
      '<strong>توقيع العقود</strong> · مجتمعين · يصدر توكيلاً: لا · يفوّض غيره: نعم',
    );
  });

  it('verifies powers not yet proven in place, for that company and that person', () => {
    const form = /<form[^>]*data-role="section-form"[\s\S]*?<\/form>/.exec(html)?.[0] ?? '';
    expect(form).toContain(`name="entity_id" value="${COMPANY_B}"`);
    expect(form).toContain(`name="person" value="${PERSON}"`);
    expect(form).toContain(`name="return_to" value="${PERSON}"`);
    expect(form).toContain('name="checks" value="MANAGER_AUTHORITY"');
    expect(form).toContain('data-role="check-role"');
  });

  it('holds a role check while it runs on its company', () => {
    const busy = partyFile({ running: { [COMPANY_B]: ['MANAGER_AUTHORITY'] } });
    expect(busy).toContain('قيد المعالجة');
    const button = /<button[^>]*data-role="check-role"[^>]*>/.exec(busy)?.[0] ?? '';
    expect(button).toContain('disabled=""');
    expect(errors).toEqual([]);
  });

  it('says what about the companies deserves a look, with links to them', () => {
    expect(html).toContain('data-role="party-concern"');
    expect(html).toContain('مرتبط بمنشأة تحت التصفية');
    expect(html).toContain(`href="/customers/${COMPANY_B}"`);
  });

  it('renders without a warning', () => {
    partyFile();
    expect(errors).toEqual([]);
  });
});
