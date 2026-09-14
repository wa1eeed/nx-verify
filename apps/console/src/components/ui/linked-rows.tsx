'use client';

import type { MouseEvent, ReactElement, ReactNode } from 'react';

/**
 * The body of a table whose rows open what they are about (unit C): press anywhere on a
 * customer's row and the file opens.
 *
 * Every row carries a real link, marked `data-row-link`, so a keyboard reaches it with Tab and
 * a screen reader reads it. A press elsewhere on the row presses that link, so the row navigates
 * exactly as the link does, the same prefetching and the same client-side move. A press on a
 * control inside the row stays with that control, a press that ends a text selection selects,
 * and a press with Ctrl, ⌘ or Shift, or with the middle button, opens a new tab as a link would.
 */

const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="switch"]';

function linkOf(event: MouseEvent<HTMLTableSectionElement>): HTMLAnchorElement | null {
  const target = event.target as HTMLElement;
  if (target.closest(INTERACTIVE)) {
    return null;
  }
  return (
    target.closest('tr[data-href]')?.querySelector<HTMLAnchorElement>('a[data-row-link]') ?? null
  );
}

export function LinkedRows({ children }: { children: ReactNode }): ReactElement {
  const open = (event: MouseEvent<HTMLTableSectionElement>, newTab: boolean): void => {
    const link = linkOf(event);
    if (link === null || (window.getSelection()?.toString() ?? '') !== '') {
      return;
    }
    if (newTab) {
      window.open(link.href, '_blank', 'noopener');
    } else {
      link.click();
    }
  };

  return (
    <tbody
      className="linked-rows"
      onClick={(event) => open(event, event.metaKey || event.ctrlKey || event.shiftKey)}
      onAuxClick={(event) => {
        if (event.button === 1) {
          open(event, true);
        }
      }}
    >
      {children}
    </tbody>
  );
}
