import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldCard, formatValue, daysUntil } from '../components/field-card';
import { ChangeBadge, FreshnessBadge } from '../components/freshness';
import { Identifier, Money } from '../components/identifier';
import { Entity360 } from '../components/entity-360';
import { FreshnessSettings } from '../components/freshness-settings';
import { Timeline } from '../components/timeline';
import RootLayout from '../app/layout';
import type { ProfileFieldView } from '../components/field-card';

/**
 * The interface rules from CLAUDE.md, asserted rather than eyeballed.
 *
 * Every one of these is a rule that is easy to honour on the day it is written and easy
 * to break six months later in a component nobody remembers.
 */

const FIELD: ProfileFieldView = {
  fieldPath: 'cr.status',
  value: 'ACTIVE',
  authority: 'Commercial Registry',
  observedAt: new Date('2026-08-01T10:00:00Z'),
  effectiveUntil: new Date('2026-09-15T10:00:00Z'),
  freshness: 'fresh',
  confidence: 1,
};

describe('every field carries its source and its timestamp', () => {
  it('renders the authority and the observation date on a field card', () => {
    const html = renderToStaticMarkup(<FieldCard field={FIELD} now={new Date('2026-09-08')} />);
    expect(html).toContain('data-role="authority"');
    expect(html).toContain('Commercial Registry');
    expect(html).toContain('data-role="observed-at"');
    expect(html).toContain('2026-08-01');
  });

  it('shows how long the field has left', () => {
    const html = renderToStaticMarkup(<FieldCard field={FIELD} now={new Date('2026-09-08')} />);
    expect(html).toContain('data-role="remaining"');
    expect(html).toContain('7 يوماً');
  });

  it('says plainly when a field has expired rather than counting down past zero', () => {
    const expired = { ...FIELD, freshness: 'expired' as const };
    const html = renderToStaticMarkup(<FieldCard field={expired} now={new Date('2026-10-01')} />);
    expect(html).toContain('انتهت منذ');
  });

  it('surfaces a confidence below one, since a name match is weaker evidence', () => {
    const html = renderToStaticMarkup(
      <FieldCard field={{ ...FIELD, confidence: 0.9 }} now={new Date('2026-09-08')} />,
    );
    expect(html).toContain('data-role="confidence"');
  });
});

describe('expired and changed never look alike', () => {
  it('gives them different colours and different markers', () => {
    const expired = renderToStaticMarkup(<FreshnessBadge state="expired" />);
    const changed = renderToStaticMarkup(<ChangeBadge severity="WARNING" />);

    expect(expired).toContain('data-kind="freshness"');
    expect(changed).toContain('data-kind="change"');

    // Neutral grey for aged knowledge, warning for a detected difference. Painting them
    // alike is what makes people stop reading alerts.
    expect(expired).toContain('--expired-fg');
    expect(changed).toContain('--changed-fg');
    expect(expired).not.toContain('--changed-fg');
    expect(changed).not.toContain('--expired-fg');
  });

  it('keeps a critical change apart from an ordinary one', () => {
    const critical = renderToStaticMarkup(<ChangeBadge severity="CRITICAL" />);
    expect(critical).toContain('--critical-fg');
    expect(critical).toContain('حرج');
  });
});

describe('identifiers read left to right inside a right to left page', () => {
  it('wraps an identifier in an explicit ltr monospace element', () => {
    const html = renderToStaticMarkup(<Identifier value="1010478213" label="CR" />);
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('class="mono"');
  });

  it('does the same for money', () => {
    const html = renderToStaticMarkup(<Money amount={44} />);
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('44.00');
    expect(html).toContain('ريال');
  });

  it('treats a value that is really a number as an identifier', () => {
    expect(formatValue(500000).numeric).toBe(true);
    expect(formatValue('شركة المثال').numeric).toBe(false);
    expect(formatValue(null).text).toBe('غير متوفر');
    expect(formatValue(true).text).toBe('نعم');
  });

  it('counts remaining days from the effective date', () => {
    expect(daysUntil(new Date('2026-09-18'), new Date('2026-09-08'))).toBe(10);
    expect(daysUntil(null)).toBeNull();
  });
});

describe('one primary button per screen', () => {
  const props = {
    header: {
      entityId: 'e1',
      displayName: 'شركة المثال',
      entityType: 'BUSINESS',
      identifiers: [{ idType: 'CR', masked: '••••••8213' }],
      score: null,
      completeness: 50,
    },
    fields: [FIELD],
    changes: [
      { fieldPath: 'cr.status', severity: 'CRITICAL' as const, detectedAt: new Date('2026-09-01') },
    ],
    timeline: [
      {
        attestationId: 'a1',
        fieldPath: 'cr.status',
        value: 'ACTIVE',
        authority: 'Commercial Registry',
        observedAt: new Date('2026-08-01T10:00:00Z'),
        triggeredBy: 'MONITOR' as const,
        changed: true,
      },
    ],
    now: new Date('2026-09-08'),
  };

  it('renders exactly one primary action on entity 360', () => {
    const html = renderToStaticMarkup(<Entity360 {...props} />);
    expect(html.match(/btn-primary/g) ?? []).toHaveLength(1);
    expect(html).toContain('تحديث التحقق');
    // The rest are still reachable, just not competing for attention.
    expect(html.match(/btn-secondary/g)?.length).toBeGreaterThan(0);
  });

  it('shows the change alert and the expiry notice as separate sections', () => {
    const withExpired = {
      ...props,
      fields: [{ ...FIELD, freshness: 'expired' as const }],
    };
    const html = renderToStaticMarkup(<Entity360 {...withExpired} />);
    expect(html).toContain('data-role="alert-changes"');
    expect(html).toContain('data-role="alert-expired"');
  });

  it('shows no alert section when there is nothing to say', () => {
    const quiet = { ...props, changes: [] };
    const html = renderToStaticMarkup(<Entity360 {...quiet} />);
    expect(html).not.toContain('data-role="alert-changes"');
    expect(html).not.toContain('data-role="alert-expired"');
  });

  it('names what triggered each line of the timeline', () => {
    const html = renderToStaticMarkup(<Timeline entries={props.timeline} />);
    // The auditor's question is not "did it change" but "how did you find out".
    expect(html).toContain('من المراقبة');
  });
});

describe('the settings screen states what an edit does before it is made', () => {
  it('says that changing a duration rewrites nothing', () => {
    const html = renderToStaticMarkup(
      <FreshnessSettings
        rows={[{ fieldPath: 'cr.status', ttlDays: 7, weight: 20, source: 'system' }]}
      />,
    );
    expect(html).toContain('data-role="inert-notice"');
    expect(html).toContain('لا يغيّر أي إفادة');
  });

  it('shows where each value came from, so it can be put back', () => {
    const html = renderToStaticMarkup(
      <FreshnessSettings
        rows={[
          { fieldPath: 'cr.status', ttlDays: 7, weight: 20, source: 'system' },
          { fieldPath: 'cr.core', ttlDays: 30, weight: 26, source: 'tenant' },
        ]}
      />,
    );
    expect(html).toContain('data-source="system"');
    expect(html).toContain('data-source="tenant"');
    expect(html).toContain('معدّل من المشترك');
  });

  it('previews the impact before saving', () => {
    const html = renderToStaticMarkup(
      <FreshnessSettings
        rows={[]}
        preview={{ fieldPath: 'address.national.city', proposedTtlDays: 10, newlyExpired: 340 }}
      />,
    );
    expect(html).toContain('data-role="impact-preview"');
    expect(html).toContain('340');
  });

  it('shows the weight next to the duration', () => {
    const html = renderToStaticMarkup(
      <FreshnessSettings
        rows={[{ fieldPath: 'cr.status', ttlDays: 7, weight: 20, source: 'system' }]}
      />,
    );
    // A duration without a weight has no meaning in the confidence score.
    expect(html).toContain('الوزن في الدرجة');
  });
});

describe('the document itself', () => {
  it('is right to left and in Arabic', () => {
    const html = renderToStaticMarkup(<RootLayout>{null}</RootLayout>);
    expect(html).toContain('lang="ar"');
    expect(html).toContain('dir="rtl"');
  });

  it('loads the two named typefaces', () => {
    const html = renderToStaticMarkup(<RootLayout>{null}</RootLayout>);
    expect(html).toContain('IBM+Plex+Sans+Arabic');
    expect(html).toContain('IBM+Plex+Mono');
  });

  it('uses solid borders and no rgba shadows', () => {
    const css = readFileSync(fileURLToPath(new URL('../app/tokens.css', import.meta.url)), 'utf8');
    expect(css).not.toMatch(/rgba\(/);
    expect(css).not.toMatch(/box-shadow/);
    expect(css).toContain('border: 1px solid');
  });

  it('carries the four brand colours', () => {
    const css = readFileSync(fileURLToPath(new URL('../app/tokens.css', import.meta.url)), 'utf8');
    for (const colour of ['#0a1628', '#00d2a8', '#00a886', '#f5b942']) {
      expect(css).toContain(colour);
    }
  });
});
