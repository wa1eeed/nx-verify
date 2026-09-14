import type { ReactElement, ReactNode } from 'react';

/**
 * A number, identifier or IBAN inside Arabic text: isolated and left to right (CLAUDE.md,
 * interface), with figures of one width so that a column of them lines up.
 */
export function Ltr({ children }: { children: ReactNode }): ReactElement {
  return (
    <bdi dir="ltr" className="ltr">
      {children}
    </bdi>
  );
}
