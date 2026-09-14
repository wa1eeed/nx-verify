import type { ReactElement } from 'react';

/**
 * The two states that must never look alike.
 *
 * Expired means our knowledge aged out. It is neutral grey, because nothing is wrong
 * with the entity, only with how recently we looked.
 *
 * Changed means we looked and something is different. That is the warning colour, and it
 * is the only warning on the screen.
 *
 * CLAUDE.md calls this mandatory, and it is: if both are painted alike, the alert stops
 * meaning anything and people stop reading it.
 */

export type FreshnessState = 'fresh' | 'expiring' | 'expired' | 'permanent';

const FRESHNESS_LABELS: Record<FreshnessState, string> = {
  fresh: 'حديث',
  expiring: 'يقترب من الانتهاء',
  expired: 'منتهي الصلاحية',
  permanent: 'دائم',
};

const FRESHNESS_STYLE: Record<FreshnessState, { fg: string; bg: string; line: string }> = {
  fresh: { fg: 'var(--fresh-fg)', bg: 'var(--fresh-bg)', line: 'var(--fresh-line)' },
  expiring: { fg: 'var(--expired-fg)', bg: 'var(--expired-bg)', line: 'var(--expired-line)' },
  // Neutral, not a warning.
  expired: { fg: 'var(--expired-fg)', bg: 'var(--expired-bg)', line: 'var(--expired-line)' },
  permanent: { fg: 'var(--ink-soft)', bg: 'var(--paper-soft)', line: 'var(--line)' },
};

export function FreshnessBadge({ state }: { state: FreshnessState }): ReactElement {
  const style = FRESHNESS_STYLE[state];
  return (
    <span
      className="badge"
      data-state={state}
      data-kind="freshness"
      style={{ color: style.fg, background: style.bg, borderColor: style.line }}
    >
      {FRESHNESS_LABELS[state]}
    </span>
  );
}

export type ChangeSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

const SEVERITY_LABELS: Record<ChangeSeverity, string> = {
  INFO: 'تغيّر مرصود',
  WARNING: 'تغيّر مرصود',
  CRITICAL: 'تغيّر حرج مرصود',
};

export function ChangeBadge({ severity }: { severity: ChangeSeverity }): ReactElement {
  const critical = severity === 'CRITICAL';
  return (
    <span
      className="badge"
      data-severity={severity}
      data-kind="change"
      style={{
        color: critical ? 'var(--critical-fg)' : 'var(--changed-fg)',
        background: critical ? 'var(--critical-bg)' : 'var(--changed-bg)',
        borderColor: critical ? 'var(--critical-line)' : 'var(--changed-line)',
      }}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}
