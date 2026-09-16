import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RiskModel, RiskSignalRow, TenantRiskModel } from '@nx-verify/core';
import { OperatorRisk } from '../src/components/operator-risk';
import { SubscriberRisk } from '../src/components/admin-subscribers/risk';

/**
 * The two risk screens (ADR-138): the platform's model, and one subscriber's disagreement.
 *
 * The rule both screens exist to keep is that a score is never a black box. Every weight a
 * reader is shown on a customer file comes from a row somebody can see and change here, and
 * the screen says which service each signal reads so «stop letting the bank check move the
 * score» stays one control rather than three.
 */

const noop = async (): Promise<void> => {};

const signal = (over: Partial<RiskSignalRow> = {}): RiskSignalRow => ({
  code: 'shared_address',
  nameAr: 'العنوان الوطني نفسه مسجل لعملاء آخرين',
  category: 'INTERSECTION',
  severity: 'LOW',
  weight: 14,
  enabled: true,
  threshold: 1,
  thresholdLabelAr: 'يبدأ العدّ من عميل آخر',
  productCode: 'NATIONAL_ADDRESS',
  productNameAr: 'العنوان الوطني',
  position: 110,
  overrides: 0,
  updatedAt: new Date('2026-09-16T09:00:00Z'),
  updatedBy: null,
  ...over,
});

const model: RiskModel = {
  bands: { highFrom: 60, mediumFrom: 30 },
  signals: [
    signal({
      code: 'liquidation',
      nameAr: 'المنشأة تحت التصفية',
      category: 'STATUS',
      severity: 'HIGH',
      weight: 70,
      threshold: null,
      thresholdLabelAr: null,
      productCode: 'CR_FULL',
      productNameAr: 'السجل التجاري',
      position: 10,
      overrides: 4,
    }),
    signal(),
    signal({
      code: 'incomplete_section',
      nameAr: 'قسم مطلوب لم يكتمل بعد',
      category: 'INCOMPLETE',
      weight: 10,
      threshold: 3,
      thresholdLabelAr: 'أكثر عدد أقسام تُحتسب',
      productCode: null,
      productNameAr: null,
      enabled: false,
      position: 130,
    }),
  ],
};

describe('the platform risk model screen', () => {
  const html = renderToStaticMarkup(
    <OperatorRisk
      view={{ model, canEdit: true, notice: null }}
      setSignalAction={noop}
      setBandsAction={noop}
      setProductAction={noop}
      setCategoryAction={noop}
    />,
  );

  it('groups the signals under the verification service whose answers they read', () => {
    expect(html).toContain('السجل التجاري');
    expect(html).toContain('العنوان الوطني');
    // The ones that read no single service say so rather than hiding among the rest.
    expect(html).toContain('لا تتبع خدمة بعينها');
  });

  it('offers to stop risk scoring for a whole service in one control', () => {
    expect(html).toContain('إيقاف احتساب الخطر لهذه الخدمة');
    expect(html).toContain('data-role="set-product-risk"');
    // Each group names the service it is, so a screen with six of them is navigable.
    expect(html).toContain('data-item="CR_FULL"');
    expect(html).toContain('data-item="none"');
  });

  it('shows the bands, and says plainly that moving them moves no score', () => {
    expect(html).toContain('حدود الدرجة');
    expect(html).toContain('لا يغيّر الدرجة نفسها، بل الكلمة التي تصفها');
  });

  it('names the threshold rather than showing a bare number nobody can read', () => {
    expect(html).toContain('يبدأ العدّ من عميل آخر');
    expect(html).toContain('أكثر عدد أقسام تُحتسب');
  });

  it('offers to stop a whole kind of doubt, which is the other axis an owner decides along', () => {
    expect(html).toContain('أنواع الخطر');
    expect(html).toContain('data-role="set-category-risk"');
    expect(html).toContain('data-item="INTERSECTION"');
    expect(html).toContain('إيقاف هذا النوع');
    // Each kind says what it actually covers, so nobody switches one off by guessing.
    expect(html).toContain('ما يربط هذا العميل بعملائك الآخرين');
    // And counts its signals in the form Arabic gives that number.
    expect(html).toContain('مؤشر واحد يُحتسب');
    expect(html).not.toContain('1 مؤشرات');
  });

  it('marks a stopped signal as stopped rather than as weighing nothing', () => {
    expect(html).toContain('موقوف');
    expect(html).toContain('لا تُحتسب ولا تظهر في أسباب الدرجة');
  });

  it('says how many subscribers disagreed with a signal, which is the drift worth reading', () => {
    expect(html).toContain('خالفه 4 من المشتركين');
  });

  it('shows no control to staff who may not change settings', () => {
    const readOnly = renderToStaticMarkup(
      <OperatorRisk
        view={{ model, canEdit: false, notice: null }}
        setSignalAction={noop}
        setBandsAction={noop}
        setProductAction={noop}
        setCategoryAction={noop}
      />,
    );
    expect(readOnly).not.toContain('data-role="set-signal"');
    expect(readOnly).not.toContain('data-role="set-bands"');
    expect(readOnly).toContain('المنشأة تحت التصفية');
  });
});

describe('one subscriber risk model', () => {
  const tenantModel: TenantRiskModel = {
    bands: { highFrom: 40, mediumFrom: 20 },
    bandsSource: 'subscriber',
    platformBands: { highFrom: 60, mediumFrom: 30 },
    signals: [
      {
        ...signal(),
        effectiveWeight: 5,
        effectiveEnabled: true,
        effectiveThreshold: 1,
        source: 'subscriber',
        decidedBy: 'nx-staff:test',
        decidedAt: new Date('2026-09-16T09:00:00Z'),
      },
      {
        ...signal({ code: 'liquidation', nameAr: 'المنشأة تحت التصفية', weight: 70 }),
        effectiveWeight: 70,
        effectiveEnabled: true,
        effectiveThreshold: null,
        source: 'platform',
        decidedBy: null,
        decidedAt: null,
      },
    ],
  };

  const html = renderToStaticMarkup(
    <SubscriberRisk
      tenantId="t-1"
      model={tenantModel}
      canManage
      setSignal={noop}
      setBands={noop}
      setCategory={noop}
    />,
  );

  it('separates what this subscriber chose from what they inherit', () => {
    expect(html).toContain('مخصّص');
    expect(html).toContain('موروث');
    expect(html).toContain('مخصّص له 1 من 2');
  });

  it('shows the platform figure beside a weight that was changed for them', () => {
    expect(html).toContain('المنصة 14');
  });

  it('offers to lift a customisation only where one was written', () => {
    expect(html).toContain('data-role="clear-tenant-signal"');
    expect(html).toContain('رفع التخصيص (المنصة: 30–60)');
  });

  it('offers the same kinds of doubt for one subscriber, carrying the subscriber with them', () => {
    expect(html).toContain('data-role="subscriber-risk-categories"');
    expect(html).toContain('name="tenant_id" value="t-1"');
  });

  it('says the subscriber cannot set their own thresholds, and why', () => {
    expect(html).toContain('من يُقاس لا يضبط مسطرته');
  });

  it('shows no control to staff who may not manage subscribers', () => {
    const readOnly = renderToStaticMarkup(
      <SubscriberRisk
        tenantId="t-1"
        model={tenantModel}
        canManage={false}
        setSignal={noop}
        setBands={noop}
        setCategory={noop}
      />,
    );
    expect(readOnly).not.toContain('data-role="set-tenant-signal"');
    expect(readOnly).not.toContain('data-role="set-tenant-bands"');
  });
});
