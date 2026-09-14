import type { ReactElement } from 'react';
import { trustBandFor } from '@nx-verify/core';

/**
 * The confidence score, drawn.
 *
 * A figure in a box is read as a fact and skipped. An arc is read as a position on a
 * range, which is what the number actually is, and a reader who never looks at the digits
 * still sees whether this file is thin.
 *
 * Three constraints shape the drawing. It is inline SVG rather than a chart library,
 * because this has to render on the server and print. It carries its band in words next
 * to it, because colour alone is not a label and a printed page has no colour at all. And
 * the words come from the domain, so the threshold that makes 61 adequate is written in
 * one place rather than invented again in a stylesheet.
 */

const SIZE = 128;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const TONE_COLOUR: Record<string, string> = {
  fresh: 'var(--fresh-line)',
  changed: 'var(--changed-line)',
  expired: 'var(--line-strong)',
  critical: 'var(--critical-line)',
};

export function TrustDial({ score }: { score: number | null }): ReactElement {
  const band = trustBandFor(score);

  if (score === null || band === null) {
    return (
      <div className="stack" data-role="trust-dial" data-band="none" style={{ gap: 'var(--s-2)' }}>
        <span className="stat-label">درجة الثقة</span>
        <span className="muted">لم تُحسب بعد</span>
        <span className="stat-hint">تُحسب بعد أول تحقق يُنتج حقلاً.</span>
      </div>
    );
  }

  // Drawn from the top and clockwise, so a reader follows it the way a gauge is read.
  const filled = (Math.max(0, Math.min(100, score)) / 100) * CIRCUMFERENCE;

  return (
    <div
      className="row"
      data-role="trust-dial"
      data-band={band.band}
      style={{ gap: 'var(--s-4)', alignItems: 'center' }}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`درجة الثقة ${score} من 100: ${band.labelAr}`}
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--paper-sunken)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={TONE_COLOUR[band.tone] ?? 'var(--line-strong)'}
          strokeWidth={STROKE}
          strokeLinecap="butt"
          strokeDasharray={`${filled} ${CIRCUMFERENCE - filled}`}
          // Starts at twelve o'clock instead of three.
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
        <text
          x={SIZE / 2}
          y={SIZE / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="mono"
          style={{ fontSize: '32px', fontWeight: 700, fill: 'var(--ink)' }}
        >
          {score}
        </text>
      </svg>

      <div className="stack" style={{ gap: 'var(--s-1)' }}>
        <span className="stat-label">درجة الثقة</span>
        <strong style={{ fontSize: '18px' }}>{band.labelAr}</strong>
        <span className="stat-hint" style={{ maxWidth: '28ch' }}>
          {band.hintAr}
        </span>
      </div>
    </div>
  );
}

export interface CoverageCounts {
  fresh: number;
  expiring: number;
  expired: number;
}

/**
 * How much of one group is current, as a bar.
 *
 * The counts are next to it in words for the same reason the dial carries its band: this
 * screen is printed and filed, and a printed bar with no numbers beside it is decoration.
 */
export function CoverageBar({ counts }: { counts: CoverageCounts }): ReactElement {
  const total = counts.fresh + counts.expiring + counts.expired;
  const segments: { key: keyof CoverageCounts; colour: string; label: string }[] = [
    { key: 'fresh', colour: 'var(--fresh-line)', label: 'حديث' },
    { key: 'expiring', colour: 'var(--changed-line)', label: 'يقترب' },
    { key: 'expired', colour: 'var(--line-strong)', label: 'منتهٍ' },
  ];

  return (
    <div className="stack" data-role="coverage" style={{ gap: 'var(--s-2)' }}>
      <div
        className="row"
        style={{
          gap: 0,
          height: '8px',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
          background: 'var(--paper-sunken)',
        }}
      >
        {total === 0
          ? null
          : segments.map((segment) =>
              counts[segment.key] === 0 ? null : (
                <span
                  key={segment.key}
                  style={{
                    width: `${(counts[segment.key] / total) * 100}%`,
                    background: segment.colour,
                    // The row centres its children, and a span with no text has no height
                    // to centre. Without this the bar draws as an empty groove.
                    alignSelf: 'stretch',
                  }}
                />
              ),
            )}
      </div>
      <div className="row" style={{ gap: 'var(--s-3)' }}>
        {segments.map((segment) =>
          counts[segment.key] === 0 ? null : (
            <span key={segment.key} className="stat-hint">
              {segment.label}{' '}
              <bdi dir="ltr" className="mono">
                {counts[segment.key]}
              </bdi>
            </span>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * The band as one chip, for a row in a list.
 *
 * A customer list is read by scanning down a column, and a column of numbers is scanned
 * badly: the reader has to hold four thresholds in their head to know which rows matter.
 * The chip carries the word and the number together, so the column sorts itself by
 * meaning as the eye goes down it.
 */
export function TrustChip({
  score,
  computedAt = null,
}: {
  score: number | null;
  /** When it was worked out. Shown rather than implied: the file ages after it. */
  computedAt?: Date | null;
}): ReactElement {
  const band = trustBandFor(score);
  if (score === null || band === null) {
    return (
      <span className="badge" data-role="trust-chip" data-band="none">
        بلا درجة
      </span>
    );
  }

  const asOf = computedAt ? `محسوبة في ${computedAt.toISOString().slice(0, 10)}. ` : '';

  return (
    <span
      className="badge"
      data-role="trust-chip"
      data-band={band.band}
      title={`${asOf}${band.hintAr}`}
      style={{
        borderColor: TONE_COLOUR[band.tone] ?? 'var(--line-strong)',
        color: 'var(--ink)',
      }}
    >
      <bdi dir="ltr" className="mono">
        {score}
      </bdi>{' '}
      {band.labelAr}
    </span>
  );
}
