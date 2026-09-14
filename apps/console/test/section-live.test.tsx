import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { historyStretches } from '../src/components/customer-file/field-history-model';
import { FieldHistory } from '../src/components/customer-file/field-history';
import { SectionLive, SectionVerifyForm } from '../src/components/customer-file/section-live';

/**
 * A section of a customer file that verifies in place, and a field's past told in stretches
 * (the owner's ask). What the browser does with them is proven against the running console;
 * here, what they draw and how the past is grouped.
 */

const point = (value: string, observedAt: string, authority = 'العنوان الوطني') => ({
  value,
  valueAr: value,
  observedAt,
  authority,
});

describe('a field’s past in stretches', () => {
  it('tells a value seen again and again once, with its first and last sighting and a count', () => {
    const stretches = historyStretches(point('حي المروج', '2026-09-14'), [
      point('حي المروج', '2026-09-14'),
      point('حي المروج', '2026-09-13'),
      point('العليا', '2026-09-12', 'السجل التجاري'),
      point('العليا', '2026-09-10', 'السجل التجاري'),
    ]);
    expect(stretches).toEqual([
      {
        valueAr: 'حي المروج',
        from: '2026-09-13',
        to: '2026-09-14',
        count: 3,
        authority: 'العنوان الوطني',
        current: true,
      },
      {
        valueAr: 'العليا',
        from: '2026-09-10',
        to: '2026-09-12',
        count: 2,
        authority: 'السجل التجاري',
        current: false,
      },
    ]);
  });

  it('keeps a value that came back as its own stretch, because it changed twice', () => {
    const stretches = historyStretches(point('نشط', '2026-09-14'), [
      point('موقوف', '2026-09-01'),
      point('نشط', '2026-08-01'),
    ]);
    expect(stretches.map((stretch) => stretch.valueAr)).toEqual(['نشط', 'موقوف', 'نشط']);
  });

  it('says on its button whether the value ever changed, and opens nothing until asked', () => {
    const stable = renderToStaticMarkup(
      <FieldHistory
        label="المدينة"
        current="الرياض"
        stretches={historyStretches(point('الرياض', '2026-09-14'), [point('الرياض', '2026-09-12')])}
      />,
    );
    expect(stable).toContain('ثابتة');
    expect(stable).not.toContain('data-changed');
    expect(stable).toContain('aria-expanded="false"');
    expect(stable).not.toContain('file-history-panel');

    const changed = renderToStaticMarkup(
      <FieldHistory
        label="الحي"
        current="حي المروج"
        stretches={historyStretches(point('حي المروج', '2026-09-14'), [
          point('العليا', '2026-09-12'),
        ])}
      />,
    );
    expect(changed).toMatch(/class="file-history-toggle" data-changed=""/);
    expect(changed).toContain('تغيّرت <bdi dir="ltr" class="ltr">1</bdi>');
  });
});

describe('a section verifying in place', () => {
  const head = <div className="file-section-head">head</div>;

  it('rests without a loader, and says it is busy with its own loader while its check runs', () => {
    const quiet = renderToStaticMarkup(
      <SectionLive
        titleAr="العنوان الوطني"
        running={false}
        head={head}
        attributes={{ 'data-section': 'ADDRESS' }}
      >
        <p>fields</p>
      </SectionLive>,
    );
    expect(quiet).toContain('data-section="ADDRESS"');
    expect(quiet).not.toContain('data-running');
    expect(quiet).not.toContain('file-section-loading');

    const busy = renderToStaticMarkup(
      <SectionLive
        titleAr="العنوان الوطني"
        running
        head={head}
        attributes={{ 'data-section': 'ADDRESS' }}
      >
        <p>fields</p>
      </SectionLive>,
    );
    expect(busy).toContain('data-running="yes"');
    expect(busy).toContain('class="file-section-body" aria-busy="true"');
    expect(busy).toContain('<span class="data-loader-title">نتحقق من العنوان الوطني</span>');
    expect(busy).toContain('نطلب البيانات من الجهة الرسمية');
  });

  it('keeps the section form a form, marked for tests and styles as before', () => {
    const html = renderToStaticMarkup(
      <SectionLive titleAr="السجل التجاري" running={false} head={head} attributes={{}}>
        <SectionVerifyForm action={async (state) => state} id="verify">
          <button type="submit">تحقق</button>
        </SectionVerifyForm>
      </SectionLive>,
    );
    expect(html).toMatch(
      /<form[^>]*class="file-section-form" data-role="section-form" id="verify"/,
    );
    expect(html).not.toContain('role="alert"');
  });
});
