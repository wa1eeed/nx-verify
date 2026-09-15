import type { ReactElement, ReactNode } from 'react';
import { Icon } from './icon';

/**
 * A sentence about what just happened, above the thing it happened to (`.notice`).
 *
 * Green with a check when something was done, red with a warning when something was refused
 * (ADR-122). A refusal is read out at once; a confirmation waits for the reader to finish what
 * they were doing.
 */
export function Notice({
  tone,
  role,
  children,
}: {
  tone: 'done' | 'refused';
  /** A name for tests and styles to find the notice by, written as data-role. */
  role?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <p
      className={`notice notice-${tone}`}
      role={tone === 'refused' ? 'alert' : 'status'}
      data-role={role}
    >
      <Icon name={tone === 'done' ? 'check' : 'alert-triangle'} size={16} />
      <span>{children}</span>
    </p>
  );
}
