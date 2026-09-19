import type { ReactElement, ReactNode } from 'react';

/**
 * The figures along the top of a screen (`.grid` of `.stat`).
 *
 * A screen names what the figure is and what it means, never how the box is drawn. The tone
 * is a role the same way a tag's is: `critical` for what already failed, `changed` for what
 * deserves a look, `expired` for knowledge that has aged. Nothing else may be tinted, so
 * that a red tile on this platform always means the same thing (CLAUDE.md, interface).
 *
 * A figure with no unit beside it is read in whatever unit the reader was last thinking in,
 * so the hint is where the unit or the qualification goes.
 */

export type StatTone = 'critical' | 'changed' | 'expired';

export function StatGrid({
  role,
  children,
}: {
  /** A name for tests and styles to find the row by, written as data-role. */
  role?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="grid" data-role={role}>
      {children}
    </section>
  );
}

/** What the figure counts. */
export function StatLabel({ children }: { children: ReactNode }): ReactElement {
  return <span className="stat-label">{children}</span>;
}

/** The figure itself, in the tabular figures a column of them lines up in. */
export function StatValue({
  role,
  children,
}: {
  role?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <strong className="stat-value" data-role={role}>
      {children}
    </strong>
  );
}

/** The unit, or what the figure does not say on its own. */
export function StatHint({
  role,
  children,
}: {
  role?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <span className="stat-hint" data-role={role}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  role,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** Left unset the tile is plain, which is what most of them are. */
  tone?: StatTone | undefined;
  role?: string | undefined;
}): ReactElement {
  return (
    <article className="stat" data-tone={tone} data-role={role}>
      <StatLabel>{label}</StatLabel>
      <StatValue>{value}</StatValue>
      {hint === undefined || hint === null ? null : <StatHint>{hint}</StatHint>}
    </article>
  );
}
