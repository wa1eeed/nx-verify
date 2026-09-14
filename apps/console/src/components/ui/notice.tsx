import type { ReactElement, ReactNode } from 'react';

/**
 * A sentence about what just happened, above the thing it happened to (`.notice`).
 *
 * Sage when something was done, the accent when something was refused. A refusal is read out
 * at once; a confirmation waits for the reader to finish what they were doing.
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
      {children}
    </p>
  );
}
