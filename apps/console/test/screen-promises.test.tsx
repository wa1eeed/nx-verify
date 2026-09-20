import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

// The request screen asks the router to redraw the frame once a request settles. A static
// render has no router, and draws nothing that would use it.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
}));

import { slicePage } from '@nx-verify/core';
import { withTenant } from '../../../packages/db/src/client';
import { openPriceVersion } from '../../../packages/core/src/billing/price-book';
import {
  createTestDatabase,
  seedTenant,
  type SeededTenant,
  type TestDatabase,
} from '../../../test/helpers/db';
import { preparePricedTenant } from '../../../test/helpers/billing';
import { Developer } from '../src/components/developer';
import { OnboardingList } from '../src/components/onboarding';
import { SETTINGS_TABS } from '../src/components/nav';
import {
  totalsOf,
  type BalanceData,
  type OutcomesData,
  type ProductData,
} from '../src/components/new-request/model';

/**
 * Three sentences a subscriber screen said, and what the code behind each of them does
 * (ADR-178).
 *
 * A screen that describes work nobody wrote is worse than a screen that says nothing: the
 * reader acts on it, looks for a settings tab that does not exist, presses the button that
 * registers nothing, or plans around a balance that is not what they will be left with. So
 * each of these asserts both halves: that the old promise is gone, and that what stands in
 * its place is what the code does.
 */

/* ------------------------------------------------- one act, one button (the sandbox) */

const developer = (isSandbox: boolean): string =>
  renderToStaticMarkup(
    <Developer
      view={{
        isSandbox,
        apiBaseUrl: 'https://api.nx.sa',
        keyPrefix: null,
        testCases: [],
        scenarioNames: [],
        products: [{ code: 'KYB_COMPLETE', nameAr: 'التحقق الشامل' }],
      }}
      runAction="/run"
    />,
  );

describe('the developer screen, beside the card that registers a sandbox request', () => {
  const live = developer(false);

  it('stops competing with the card: no second ask, and none of it pointing at support', () => {
    // The header carried a primary «اطلب مساحة اختبار» to /settings/support, which registers
    // nothing, while the card above this screen registers the ask (ADR-173). Two buttons for
    // one act, one of which works, is worse than one: the reader presses the larger one.
    expect(live).not.toContain('/settings/support');
    expect(live).not.toContain('اطلب مساحة اختبار');
    expect(live).not.toContain('btn-primary');
    // On a sandbox the header still has its one act, which is issuing that workspace's key.
    expect(developer(true)).toContain('class="btn btn-primary"');
    expect(developer(true)).toContain('إصدار مفتاح');
  });

  it('says how a sandbox is entered, as the path that creates one does', () => {
    const paragraph =
      /<p class="muted" data-role="playground-elsewhere">[\s\S]*?<\/p>/.exec(live)?.[0] ?? '';
    expect(paragraph).not.toBe('');

    // It promised «وتدخلها بنفس بريدك», which reads as the same sign in. What is made is an
    // account with a first password the person is required to change.
    expect(paragraph).not.toContain('بنفس بريدك');
    expect(paragraph).not.toContain('من الدعم');
    expect(paragraph).toContain('بكلمة مرور أولى');
    expect(paragraph).toContain('يُطلب تغييرها عند أول دخول');
    // And it is asked for in one place, which is named.
    expect(paragraph).toContain('بطاقة «مساحة الاختبار»');
  });
});

/* --------------------------------------------- a journey is defined where it is defined */

describe('the onboarding list with nothing in it yet', () => {
  const empty = renderToStaticMarkup(
    <OnboardingList
      page={slicePage([], { page: 1, size: 25 })}
      tallies={{ open: 0, late: 0, approved: 0 }}
      params={{}}
    />,
  );

  it('sends nobody to a settings screen for journeys, because there is none', () => {
    expect(empty).not.toContain('برحلة معرّفة في الإعدادات');
    expect(empty).not.toContain('الإعدادات');
    expect(empty).toContain('لا ملفات تأهيل بعد');
    // The same thing the other onboarding screen says, because it is the same fact:
    // `defineJourney` is called from scripts/provision.ts and from nowhere else.
    expect(empty).toContain('مسارات التأهيل يعرّفها مشغّل المنصة');
  });

  it('calls the thing one name, rather than two on one screen', () => {
    // The empty state was rewritten to «مسار» while the tile hint still said «رحلة التأهيل»
    // and the table header «الرحلة», so the screen named one object twice and the reader had
    // to guess they were the same. Both now read as the open screen reads.
    const withRow = renderToStaticMarkup(
      <OnboardingList
        page={slicePage(
          [
            {
              caseId: 'c1',
              reference: 'ONB-2026-000001',
              journeyNameAr: 'تأهيل تاجر',
              entityName: null,
              status: 'IN_PROGRESS',
              outcome: null,
              done: 1,
              total: 3,
              dueAt: new Date('2026-09-20T00:00:00Z'),
              overdue: false,
            },
          ],
          { page: 1, size: 25 },
        )}
        tallies={{ open: 1, late: 0, approved: 0 }}
        params={{}}
      />,
    );

    expect(empty).not.toContain('رحلة');
    expect(empty).toContain('المهلة من مسار التأهيل');
    expect(withRow).not.toContain('<th>الرحلة</th>');
    expect(withRow).toContain('<th>المسار</th>');
  });

  it('measures the absence rather than trusting it: no tab and no route under settings', () => {
    const settings = readdirSync(
      fileURLToPath(new URL('../src/app/(app)/settings', import.meta.url)),
      { withFileTypes: true },
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(settings).not.toContain('journeys');
    expect(SETTINGS_TABS.map((tab) => tab.href)).not.toContain('/settings/journeys');
    expect(SETTINGS_TABS.some((tab) => tab.label.includes('رحلات'))).toBe(false);
    expect(SETTINGS_TABS.some((tab) => tab.label.includes('مسارات'))).toBe(false);
  });
});

/* ------------------------------------------------------ a ceiling, and never a promise */

const product = (
  overrides: Partial<ProductData> & Pick<ProductData, 'productCode'>,
): ProductData => {
  const unitPriceHalalas =
    overrides.unitPriceHalalas === undefined ? 300 : overrides.unitPriceHalalas;
  return {
    nameAr: 'منتج',
    nameEn: 'Product',
    summaryAr: null,
    appliesTo: ['COMPANY'],
    availability: 'AVAILABLE',
    unitPriceHalalas,
    // No plan here reprices a run past its capacity, so the most an operation can be charged
    // is what it is priced at. The case where they differ is in new-request-screen.test.tsx.
    ceilingUnitPriceHalalas: unitPriceHalalas,
    allowed: true,
    refusalAr: null,
    perManager: false,
    needsIban: false,
    needsCertificate: false,
    selectedByDefault: true,
    ...overrides,
  };
};

const WALLET: BalanceData = { capacityRemaining: null, walletAvailableHalalas: 500_000 };

const OUTCOMES: OutcomesData = {
  perProductAr: {
    CR_FULL:
      'نتيجة «غير موجود» تُحسب بـ50% من السعر، والنتيجة المخزّنة تُحسب كاملة، والفشل التقني والخطوة المتخطاة لا تُحسبان.',
    NATIONAL_ADDRESS:
      'نتيجة «غير موجود» لا تُحسب، والنتيجة المخزّنة تُحسب بـ25% من السعر، والفشل التقني والخطوة المتخطاة لا تُحسبان.',
  },
  anyAr:
    'الفشل التقني والخطوة المتخطاة لا تُحسبان، وما تُحسب به الحالات الأخرى في «أسعار المنتجات».',
};

describe('what the request screen says pressing «تحقق من الكل» will take', () => {
  const registry = product({ productCode: 'CR_FULL' });
  const address = product({ productCode: 'NATIONAL_ADDRESS', unitPriceHalalas: 200 });

  it('promises no amount and no balance after it, and says which figure is which', () => {
    const totals = totalsOf([registry, address], null, WALLET, OUTCOMES);

    // The promise that was there: a sum taken and a balance left, both stated flatly.
    expect(totals.lineAr).not.toContain('سيُخصم من الرصيد ويبقى');
    expect(totals.lineAr).not.toContain('الإجمالي');
    // What is true: 5.00 is the most it can take, because every run holds its unit price
    // and settles at what its result earns, so the balance after it is a floor.
    expect(totals.lineAr).toBe(
      'الحدّ الأعلى 5.00 ر.س من رصيدك · لا يقل الرصيد بعدها عن 4,995.00 ر.س',
    );
    expect(totals.walletHalalas).toBe(500);
  });

  it('says why it is a ceiling in the words of the price rows, and only when they agree', () => {
    expect(totalsOf([registry], null, WALLET, OUTCOMES).outcomesAr).toBe(
      OUTCOMES.perProductAr['CR_FULL'],
    );
    // Two products with different shares: naming either one over the pair would be naming a
    // share that does not hold for what is ticked.
    expect(totalsOf([registry, address], null, WALLET, OUTCOMES).outcomesAr).toBe(OUTCOMES.anyAr);
    // A product whose price row was never read carries no sentence of its own.
    expect(
      totalsOf([registry, product({ productCode: 'IBAN_VERIFICATION' })], null, WALLET, OUTCOMES)
        .outcomesAr,
    ).toBe(OUTCOMES.anyAr);
    // And with no shares read at all the screen says nothing rather than guess.
    expect(totalsOf([registry], null, WALLET).outcomesAr).toBeNull();
  });

  it('names no riyals and no share while the package and the bundles pay', () => {
    const totals = totalsOf(
      [registry, address],
      null,
      {
        capacityRemaining: 40,
        walletAvailableHalalas: 0,
      },
      OUTCOMES,
    );

    expect(totals.lineAr).toBe('تُحتسب من الباقة والحزم لا من رصيدك · لا يقل ما يبقى عن 38 عملية');
    expect(totals.lineAr).not.toContain('ر.س');
    // A share is a share of a riyal price, and a run inside the capacity moves no riyals.
    expect(totals.outcomesAr).toBeNull();
    expect(totals.affordable).toBe(true);
  });

  it('refuses to state a ceiling for an operation that has no price in force', () => {
    const unpriced = product({ productCode: 'ARTICLES_OF_ASSOCIATION', unitPriceHalalas: null });
    const totals = totalsOf([registry, unpriced], null, WALLET, OUTCOMES);

    expect(totals.lineAr).toContain('لا سعر نافذ لبعض العمليات المختارة');
    expect(totals.lineAr).not.toContain('الحدّ الأعلى');
    expect(totals.outcomesAr).toBeNull();
  });
});

/* ------------------------------------------------ and the same, on a real price row */

describe('the request screen on a real subscriber', () => {
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

  const screen = async (): Promise<string> => {
    const { default: NewRequestPage } = await import('../src/app/(app)/verifications/new/page.js');
    const element: ReactElement = await NewRequestPage({ searchParams: Promise.resolve({}) });
    return renderToStaticMarkup(element);
  };

  it('reads the shares of the very products it ticks, rather than printing a sentence', async () => {
    const html = await screen();

    expect(html).not.toContain('سيُخصم من الرصيد ويبقى');
    expect(html).toContain('data-role="total">الحدّ الأعلى');
    expect(html).toContain('لا يقل الرصيد بعدها عن');
    // The default list share of a check: half the price for an authority's «لا يوجد».
    expect(html).toContain('data-role="charged-outcomes"');
    expect(html).toContain('الفشل التقني والخطوة المتخطاة لا تُحسبان');
  });

  it('moves the sentence when the stored share moves', async () => {
    const before = await screen();
    expect(before).toContain('تُحسب بـ50% من السعر');

    // Every check ticked by default repriced to the same pair of shares, so the selection
    // agrees on one sentence and the screen may say it.
    const codes = /data-product="([A-Z_]+)"/g;
    const products = [...before.matchAll(codes)].map((match) => match[1] as string);
    await withTenant(db.appPool, tenant.tenantId, async (tx) => {
      for (const productCode of products) {
        await openPriceVersion(tx, {
          productCode,
          unitPriceHalalas: 20_00,
          negativePct: 0,
          cachePct: 0.25,
        });
      }
    });

    const after = await screen();
    const line =
      /<p class="request-bar-line" data-role="charged-outcomes">([\s\S]*?)<\/p>/.exec(after)?.[1] ??
      '';
    expect(line).toContain('نتيجة «غير موجود» لا تُحسب');
    expect(line).toContain('والنتيجة المخزّنة تُحسب بـ25% من السعر');
    expect(line).not.toContain('تُحسب بـ50% من السعر');
  });
});
