import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { CheckDefinition, CustomerFile, ProfileSection } from '@nx-verify/core';
import { withTenant } from '../../../packages/db/src/client';
import { openPriceVersion } from '../../../packages/core/src/billing/price-book';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db';
import { preparePricedTenant } from '../../../test/helpers/billing';
import { CustomerFileScreen, type CustomerFileView } from '../src/components/customer-file';

/**
 * What the subscriber is told about a run that is not a plain success (ADR-170).
 *
 * «أسعار المنتجات» promised «العمليات الفاشلة لا تُحسب» and the verify dialog of a customer
 * file repeated it, while the price row charged an authority's «لا يوجد» at half the price
 * and a cached answer at the whole of it. That is money taken after the screen said it would
 * not be. These assert the opposite property of the new wording: that it is derived from the
 * share stored for that product, so moving the share moves the sentence.
 */

describe('the prices screen of the subscriber', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    tenant = await seedTenant(db.appPool, 'شركة المثال للتجارة');
    await preparePricedTenant(db, tenant.tenantId);

    process.env['NX_APP_DATABASE_URL'] = db.appConnectionString;
    process.env['NX_CONSOLE_TENANT_ID'] = tenant.tenantId;
    process.env['NX_MASTER_KEY'] = Buffer.alloc(32, 7).toString('base64');
  });

  afterAll(async () => {
    const { closePool } = await import('../src/lib/context');
    const { closeSessionPool } = await import('../src/lib/session');
    await closePool();
    await closeSessionPool();
    await db.close();
  });

  const render = async (element: Promise<ReactElement>): Promise<string> =>
    renderToStaticMarkup(await element);

  const prices = async (): Promise<string> => {
    const { default: PricesPage } = await import('../src/app/(app)/billing/prices/page.js');
    return render(PricesPage());
  };

  /** One product's row, so a share is read against the product it belongs to. */
  const rowOf = (html: string, productCode: string): string =>
    new RegExp(`<tr data-check="${productCode}">[\\s\\S]*?</tr>`).exec(html)?.[0] ?? '';

  it('never promises that a run which is not a success costs nothing', async () => {
    const html = await prices();

    expect(html).not.toContain('العمليات الفاشلة لا تُحسب');
    expect(html).not.toContain('يُخصم فقط عند نجاح العملية');
    // What is true of every price row, and the whole of what a subtitle may claim.
    expect(html).toContain('الفشل التقني والخطوة المتخطاة لا تُحسبان');
    expect(html).toContain('السعر بالريال لعملية ناجحة كاملة');
  });

  it('says what each product charges in the other cases, from its own price row', async () => {
    const html = await prices();
    const row = rowOf(html, 'CR_FULL');

    expect(row).toContain('نتيجة «غير موجود»');
    // The share of the default list: half the price, said as a figure rather than hidden.
    expect(row).toContain('تُحسب بـ50% من السعر');
    expect(row).toContain('نتيجة مخزّنة');
    expect(row).toContain('تُحسب كاملة');
  });

  it('moves the wording when the stored share moves, and only for that product', async () => {
    await withTenant(db.appPool, tenant.tenantId, (tx) =>
      openPriceVersion(tx, {
        productCode: 'CR_FULL',
        unitPriceHalalas: 20_00,
        negativePct: 0,
        cachePct: 0.25,
      }),
    );

    const html = await prices();
    const changed = rowOf(html, 'CR_FULL');
    const untouched = rowOf(html, 'NATIONAL_ADDRESS');

    // Zero, so here the old sentence happens to be true, and it is said because the row
    // says so rather than because it is the sentence the screen always printed.
    expect(changed).toContain('لا تُحسب');
    expect(changed).toContain('تُحسب بـ25% من السعر');
    expect(changed).not.toContain('تُحسب بـ50% من السعر');
    // A share is per product: the check nobody repriced still reads its own row.
    expect(untouched).toContain('تُحسب بـ50% من السعر');
  });

  it('names no share while the package pays, because no riyal price is charged', async () => {
    // A term that bought a capacity: the price column then reads «من الباقة» and the tax
    // column reads nothing, because a run inside the capacity moves no money at all. A
    // share is a share of that money, so it says nothing here too rather than name a
    // fraction of a figure this row does not show and this subscriber is not charged.
    await db.operatorPool.query(
      'UPDATE tenant_commitments SET included_transactions = 3000, transactions_used = 0 WHERE tenant_id = $1',
      [tenant.tenantId],
    );

    const row = rowOf(await prices(), 'NATIONAL_ADDRESS');

    expect(row).toContain('من الباقة');
    expect(row).not.toContain('تُحسب');
    expect(row).not.toContain('نتيجة «غير موجود»');
  });
});

const OBSERVED = new Date('2026-09-12T11:08:00Z');

const check = (productCode: string, nameAr: string, section: ProfileSection): CheckDefinition => ({
  productCode,
  nameAr,
  nameEn: productCode,
  summaryAr: null,
  section,
  moduleCode: section,
  appliesTo: ['COMPANY'],
  order: 1,
  availability: 'AVAILABLE',
  requiredInputs: [],
  allowedInputs: [],
});

const CR = check('CR_FULL', 'السجل التجاري', 'REGISTRY');
const ADDRESS = check('NATIONAL_ADDRESS', 'العنوان الوطني', 'ADDRESS');

const file: CustomerFile = {
  entityId: '6b7f4a0e-2d4c-4f5e-9a1b-0c3d2e1f4a5b',
  entityType: 'BUSINESS',
  displayName: 'شركة أفق المدى للتقنية',
  kind: 'COMPANY',
  kindLabelAr: 'شركة',
  createdAt: new Date('2026-03-02T08:00:00Z'),
  identifiers: [{ idType: 'CR', masked: '••••••4567', display: '1010234567', isPrimary: true }],
  primaryIdentifier: { labelAr: 'س.ت', masked: '••••••4567', display: '1010234567' },
  status: { textAr: 'فعال', tone: 'fresh' },
  sections: [],
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
    statusAr: 'غير موثّق',
    statusTone: 'neutral',
    standing: 'IN_PROGRESS',
    standingAr: 'قيد الاستكمال',
    bands: { highFrom: 60, mediumFrom: 30 },
    riskLevel: 'LOW',
    riskLabelAr: 'منخفضة',
    riskScore: null,
    riskReasons: [],
  },
  intersections: [],
  lastVerifiedAt: OBSERVED,
  nextReviewAt: null,
  completeness: 0,
  sectionsDone: 0,
  sectionsRequired: 2,
  kyc: { verified: 0, total: 0, lineAr: 'لا مديرون بعد' },
  openChanges: 0,
  checks: [CR, ADDRESS],
  nameMatchThresholdPct: 85,
};

function fileScreen(shares: CustomerFileView['shares'], showPrices = true): string {
  const view: CustomerFileView = {
    file,
    bundles: { refreshAll: 'bundle-all', sections: {}, managers: {} },
    prices: { CR_FULL: 2000, NATIONAL_ADDRESS: 600 },
    shares,
    refusals: {},
    fromPackage: false,
    showPrices,
    results: null,
    running: [],
    error: null,
    histories: {},
    timeline: [],
    now: new Date('2026-09-14T09:00:00Z'),
  };
  return renderToStaticMarkup(
    <CustomerFileScreen view={view} action="/customers/verify" share={{ panel: null }} />,
  );
}

describe('the estimate in a customer file', () => {
  const half = {
    CR_FULL: { productCode: 'CR_FULL', notFoundPct: 0.5, cachedPct: 1 },
    NATIONAL_ADDRESS: { productCode: 'NATIONAL_ADDRESS', notFoundPct: 0.5, cachedPct: 1 },
  };

  it('says the estimate is the price of a run that succeeds in full', () => {
    const html = fileScreen(half);

    expect(html).toContain('وهي سعر نجاح كل عملية كاملةً');
    expect(html).not.toContain('العمليات الفاشلة لا تُحسب');
  });

  it('states the shares it was given rather than a sentence of its own', () => {
    expect(fileScreen(half)).toContain('نتيجة «غير موجود» تُحسب بـ50% من السعر');

    const free = {
      CR_FULL: { productCode: 'CR_FULL', notFoundPct: 0, cachedPct: 0 },
      NATIONAL_ADDRESS: { productCode: 'NATIONAL_ADDRESS', notFoundPct: 0, cachedPct: 0 },
    };
    const html = fileScreen(free);
    expect(html).toContain('نتيجة «غير موجود» لا تُحسب');
    expect(html).toContain('والنتيجة المخزّنة لا تُحسب');
  });

  it('names no share when the checks in the dialog do not share one', () => {
    const mixed = {
      CR_FULL: { productCode: 'CR_FULL', notFoundPct: 0.5, cachedPct: 1 },
      NATIONAL_ADDRESS: { productCode: 'NATIONAL_ADDRESS', notFoundPct: 0, cachedPct: 1 },
    };
    const html = fileScreen(mixed);

    expect(html).not.toContain('تُحسب بـ50% من السعر');
    expect(html).toContain('وما تُحسب به الحالات الأخرى في «أسعار المنتجات»');
    expect(html).toContain('الفشل التقني والخطوة المتخطاة لا تُحسبان');
  });

  it('says only what holds for every price row while the shares are unread', () => {
    const html = fileScreen(undefined, false);

    expect(html).toContain('يُخصم من الرصيد عن كل عملية بحسب نتيجتها');
    expect(html).toContain('الفشل التقني والخطوة المتخطاة لا تُحسبان');
    expect(html).not.toContain('العمليات الفاشلة لا تُحسب');
    expect(html).not.toContain('عند نجاح كل عملية');
  });
});
