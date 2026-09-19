import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaseBundlePanel } from '../src/app/(app)/verifications/onboarding/[id]/bundle';
import { Timeline, type TimelineEntryView } from '../src/components/timeline';

/**
 * The sealed bundle and the ledger behind a field.
 *
 * Both were built, tested and exported, and neither had a screen: a composite file's checks
 * were sealed one by one with nothing binding them to the file, and every value a field ever
 * held sat in a table no reader could open.
 */

const noop = async (): Promise<void> => {};

const HASH = 'a'.repeat(64);

describe('the evidence bundle of a composite file', () => {
  it('offers the seal once a check has run, and says what it covers', () => {
    const html = renderToStaticMarkup(
      <CaseBundlePanel caseId="c1" runCount={2} stepCount={3} seals={[]} action={noop} />,
    );
    expect(html).toContain('data-role="seal-bundle"');
    expect(html).toContain('اختم حزمة الأدلة');
    // The reader is told the bundle is not the whole file before they hand it to anybody.
    expect(html).toContain('ويذكر الفحوص التي لم تُشغَّل وسببها');
    expect(html).toContain('data-role="no-seals"');
  });

  it('does not offer a seal on a file where nothing has been verified', () => {
    const html = renderToStaticMarkup(
      <CaseBundlePanel caseId="c1" runCount={0} stepCount={3} seals={[]} action={noop} />,
    );
    expect(html).toContain('data-role="bundle-empty"');
    expect(html).not.toContain('data-role="seal-bundle"');
  });

  it('shows a reader who may not issue documents what was sealed, without the button', () => {
    const html = renderToStaticMarkup(
      <CaseBundlePanel
        caseId="c1"
        runCount={2}
        stepCount={2}
        seals={[
          {
            evidenceId: 'e1',
            contentHash: HASH,
            publicToken: 'tok-1',
            signedAt: new Date('2026-09-18T09:00:00Z'),
          },
        ]}
      />,
    );
    expect(html).not.toContain('data-role="seal-bundle"');
    expect(html).toContain(HASH);
    // The fingerprint is useless without a way to ask us about it.
    expect(html).toContain('/verifications/evidence?ref=tok-1');
  });
});

describe('the ledger of a field', () => {
  const entry = (over: Partial<TimelineEntryView> = {}): TimelineEntryView => ({
    attestationId: 'a1',
    fieldPath: 'cr.status',
    value: 'ACTIVE',
    authority: 'وزارة التجارة',
    observedAt: new Date('2026-08-01T10:00:00Z'),
    triggeredBy: 'MONITOR',
    changed: false,
    ...over,
  });

  it('says a line was replaced rather than hiding it', () => {
    const html = renderToStaticMarkup(
      <Timeline entries={[entry({ current: false, changed: true, runReference: 'NX-77' })]} />,
    );
    // A row is never edited and never removed. That is the argument for writing facts this
    // way, and it is only an argument if somebody can read it.
    expect(html).toContain('استُبدلت لاحقاً');
    expect(html).toContain('تغيّرت هنا');
    expect(html).toContain('NX-77');
    expect(html).toContain('من المراقبة');
  });

  it('says the verification behind a fact is no longer known rather than leaving a blank', () => {
    const html = renderToStaticMarkup(<Timeline entries={[entry({ triggeredBy: null })]} />);
    expect(html).toContain('لم يعد معروفاً');
  });

  it('has an empty state that does not read as an error', () => {
    expect(renderToStaticMarkup(<Timeline entries={[]} />)).toContain('لا توجد إفادات بعد');
  });
});
