import Link from 'next/link';
import type { ReactElement } from 'react';

/**
 * The screens inside one section.
 *
 * Links rather than script, for the same reason the tabs of a customer file are: a
 * refresh, a bookmark and a shared address all open the same tab. The router makes the
 * move, so the frame stays and only the screen changes (unit C4).
 */

export interface SectionTab {
  href: string;
  label: string;
}

export function SectionTabs({
  tabs,
  current,
  label,
}: {
  tabs: readonly SectionTab[];
  /** The href of the open tab. */
  current: string;
  label: string;
}): ReactElement {
  return (
    <nav className="tabs" aria-label={label} data-role="section-tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className="tab"
          {...(tab.href === current ? { 'aria-current': 'page' as const } : {})}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
