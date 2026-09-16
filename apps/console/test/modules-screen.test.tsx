import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ModuleView, TenantModuleView } from '@nx-verify/core';
import { OperatorModules } from '../src/components/operator-modules';
import { SubscriberModules } from '../src/components/admin-subscribers/modules';

/**
 * The two module screens (ADR-137): the catalogue of what the platform sells, and the switch
 * on one subscriber's page.
 *
 * What is asserted is the wording as much as the markup, because both screens exist to stop a
 * member of staff switching something off without knowing what leaves with it.
 */

const noop = async (): Promise<void> => {};

const moduleView = (over: Partial<ModuleView> = {}): ModuleView => ({
  code: 'PROPERTY',
  nameAr: 'العقار',
  nameEn: 'Property',
  summaryAr: 'الصك العقاري: رقمه ومالكه ووصف العقار.',
  section: 'PROPERTY',
  position: 7,
  core: false,
  defaultOn: false,
  status: 'active',
  products: [
    {
      productCode: 'PROPERTY_VERIFICATION',
      nameAr: 'التحقق من العقار',
      availability: 'COMING_SOON',
      inFile: true,
    },
    {
      productCode: 'PROPERTY_DEED',
      nameAr: 'الصك العقاري',
      availability: 'AVAILABLE',
      inFile: false,
    },
  ],
  switchedOn: 3,
  switchedOff: 0,
  ...over,
});

const tenantModule = (over: Partial<TenantModuleView> = {}): TenantModuleView => ({
  code: 'INCOME',
  nameAr: 'الدخل',
  summaryAr: 'الدخل من الحساب البنكي بموافقة صاحبه.',
  section: 'INCOME',
  position: 8,
  core: false,
  enabled: false,
  source: 'default',
  decided: null,
  decidedBy: null,
  decidedAt: null,
  note: null,
  products: 1,
  productsInPlan: 0,
  ...over,
});

describe('the modules catalogue', () => {
  const html = renderToStaticMarkup(
    <OperatorModules
      view={{
        modules: [
          moduleView({
            code: 'REGISTRY',
            nameAr: 'السجل التجاري',
            section: 'REGISTRY',
            core: true,
            defaultOn: true,
            position: 1,
            switchedOn: 0,
            switchedOff: 0,
            products: [
              {
                productCode: 'CR_FULL',
                nameAr: 'السجل التجاري',
                availability: 'AVAILABLE',
                inFile: true,
              },
            ],
          }),
          moduleView(),
        ],
      }}
    />,
  );

  it('says of each module what it adds to a customer file, by the section name itself', () => {
    // The module is «العقار» and the section it draws is «العقارات». The screen names the
    // section, because that is what the reader will look for in the file.
    expect(html).toContain('يرسم قسم «العقارات» في ملف العميل');
    expect(html).toContain('يرسم قسم «البيانات الأساسية» في ملف العميل');
  });

  it('names each module card, so a screen of eight of them is navigable', () => {
    expect(html).toContain('data-item="REGISTRY"');
    expect(html).toContain('data-item="PROPERTY"');
  });

  it('counts the modules, the services under them, and the drift from the plans', () => {
    expect(html).toContain('خدمات التحقق');
    expect(html).toContain('الإضافية منها لا تُمنح إلا بقرار');
  });

  it('marks the module that cannot be switched off, and the ones given only by decision', () => {
    expect(html).toContain('أساسي، لا يُطفأ');
    expect(html).toContain('إضافي، بقرار');
  });

  it('separates a service that shows in the file from one sold only through the interface', () => {
    expect(html).toContain('ملف العميل والواجهة البرمجية');
    expect(html).toContain('الواجهة البرمجية</td>');
  });

  it('shows a service that is not open at the source as coming rather than as available', () => {
    expect(html).toContain('قريباً');
  });

  it('counts how far the plans have drifted, which is the figure worth reading', () => {
    expect(html).toContain('خرجت عن الباقات');
    expect(html).toContain('لم يخرج أحد عن باقته في هذا الموديول');
    expect(html).toContain('فُعّل بقرار خاص لـ');
  });
});

describe('the modules of one subscriber', () => {
  const render = (modules: TenantModuleView[], canManage = true): string =>
    renderToStaticMarkup(
      <SubscriberModules tenantId="t-1" modules={modules} canManage={canManage} setModule={noop} />,
    );

  it('warns what leaves with a module before anybody switches one off', () => {
    const html = render([tenantModule()]);
    expect(html).toContain('يختفي قسمه من ملفات عملاء هذا المشترك');
    expect(html).toContain('ولا يُحسب ناقصاً عليه');
    expect(html).toContain('وتُرفض منتجاته');
  });

  it('says where each answer came from, so an inherited one is not read as a choice', () => {
    expect(render([tenantModule()])).toContain('الافتراضي');
    expect(render([tenantModule({ source: 'plan', enabled: true })])).toContain('من الباقة');
    expect(render([tenantModule({ source: 'switch', enabled: true, decided: true })])).toContain(
      'قرار خاص بهذا المشترك',
    );
  });

  it('offers to lift a decision only where one was written', () => {
    expect(render([tenantModule()])).not.toContain('رفع القرار');
    expect(render([tenantModule({ decided: false })])).toContain('رفع القرار');
  });

  it('offers no switch at all on the module every file is drawn from', () => {
    const html = render([tenantModule({ code: 'REGISTRY', core: true, enabled: true })]);
    expect(html).toContain('أساس كل ملف عميل');
    expect(html).not.toContain('data-role="set-module"');
  });

  it('shows the switches to nobody who may not manage subscribers', () => {
    const html = render([tenantModule()], false);
    expect(html).not.toContain('data-role="set-module"');
    expect(html).toContain('الدخل');
  });
});
