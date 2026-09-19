import type { ReactElement, ReactNode } from 'react';

/**
 * An act that cannot be undone, in two steps (ADR-167).
 *
 * The consequence is spelled out before the control that causes it exists, which is the
 * cheapest confirmation there is and needs no dialog. The consequence is a prop rather than
 * something the screen remembers to put first, because a disclosure that opens straight onto
 * a button is the thing this pattern was written to prevent.
 *
 * The summary is the act in the words of somebody about to do it, never «إلغاء», which an
 * Arabic reader takes as Cancel.
 */
export function Disclosure({
  summary,
  consequence,
  role,
  children,
}: {
  summary: string;
  /** What happens, and what does not come back, said before the control appears. */
  consequence: ReactNode;
  /** A name for tests and styles to find the disclosure by, written as data-role. */
  role?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <details className="revoke" data-role={role}>
      <summary>{summary}</summary>
      <div className="revoke-body">
        <span className="faint">{consequence}</span>
        {children}
      </div>
    </details>
  );
}
