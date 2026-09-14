import type { ReactElement } from 'react';
import { classes } from './classes';

/**
 * A share of something, as a pill-shaped bar (README: the balance, product consumption and
 * file completeness bars).
 *
 * The track is the neutral ramp and the fill a tone: sage by default, the accent where the
 * screen says a lower share needs attention. `thin` is 7px, `thick` 9px. The width is the
 * data itself; everything that is design comes from the sheets.
 */
export function ProgressBar({
  value,
  max,
  label,
  tone = 'accent-2',
  size = 'thin',
}: {
  value: number;
  max: number;
  /** What the bar measures, for screen readers. */
  label: string;
  tone?: 'accent-2' | 'accent' | undefined;
  size?: 'thin' | 'thick' | undefined;
}): ReactElement {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const percent = Math.round(share * 100);

  return (
    <div
      className={classes('progress', size === 'thick' && 'progress-thick')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <span
        className={`progress-fill progress-fill-${tone}`}
        style={{ inlineSize: `${percent}%` }}
      />
    </div>
  );
}
