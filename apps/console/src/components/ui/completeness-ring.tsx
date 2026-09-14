import type { ReactElement } from 'react';

/**
 * How complete something is, as a ring (README, screen 03).
 *
 * A 78px ring, radius 32 and stroke 9, the track in the neutral ramp and the share in sage
 * with round ends, starting from the top. The share is the only number in it; its size and
 * colours are the sheets'.
 */
const RADIUS = 32;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function CompletenessRing({
  percent,
  label,
}: {
  percent: number;
  /** What the ring measures, for screen readers. */
  label: string;
}): ReactElement {
  const share = Math.min(100, Math.max(0, percent)) / 100;
  return (
    <svg className="completeness-ring" viewBox="0 0 78 78" role="img" aria-label={label}>
      <circle className="completeness-ring-track" cx="39" cy="39" r={RADIUS} />
      <circle
        className="completeness-ring-fill"
        cx="39"
        cy="39"
        r={RADIUS}
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - share)}
        transform="rotate(-90 39 39)"
      />
    </svg>
  );
}
