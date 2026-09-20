import Link from 'next/link';
import type { ReactElement } from 'react';

/**
 * The screens inside one section.
 *
 * Links rather than script, for the same reason the tabs of a customer file are: a
 * refresh, a bookmark and a shared address all open the same tab. The router makes the
 * move, so the frame stays and only the screen changes (unit C4).
 *
 * A tab can carry a count, the way a place in the sidebar can (ADR-186). The sidebar says that
 * something is waiting somewhere in this section; the tab says which screen it is waiting on,
 * and it is the surface that actually answers the number, because pressing it opens the list
 * the number counted. The first of these is the queue of sandbox asks under «المشتركون», and
 * the shape is here rather than in that screen because the next one is «بانتظار قرار» under
 * the customers, which has the same problem and no number yet.
 */

export interface SectionTab {
  href: string;
  label: string;
}

export function SectionTabs({
  tabs,
  current,
  label,
  counts = {},
  countLabel = 'بالانتظار',
}: {
  tabs: readonly SectionTab[];
  /** The href of the open tab. */
  current: string;
  label: string;
  /** A number to show beside a tab, keyed by its href. Zero draws nothing. */
  counts?: Readonly<Record<string, number>>;
  /**
   * What the number counts, read aloud after it and shown to nobody. «بالانتظار» rather than
   * «جديد», because a queue is not news: what is behind these numbers has been sitting there.
   */
  countLabel?: string;
}): ReactElement {
  return (
    <nav className="tabs" aria-label={label} data-role="section-tabs">
      {tabs.map((tab) => {
        const count = counts[tab.href] ?? 0;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="tab"
            {...(tab.href === current ? { 'aria-current': 'page' as const } : {})}
          >
            {tab.label}
            {count > 0 ? (
              <span className="tab-count" data-role="tab-count">
                <bdi dir="ltr" className="ltr">
                  {count}
                </bdi>
                <span className="visually-hidden">{` ${countLabel}`}</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
