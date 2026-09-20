'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';
import { Icon, type IconName } from './ui/icon';

/**
 * The places in the sidebar, one of which is open (README, shared frame template).
 *
 * A pill per place with its icon; the open place is filled with the accent, and it carries
 * aria-current so it is announced and not merely tinted. Hover fills from the accent ramp
 * and keyboard focus is the system's :focus-visible ring. A place can carry a count, such as
 * the new alerts waiting under the customers.
 *
 * What the count is counting is said out loud for a screen reader, and the word is the
 * caller's (ADR-186): the portal counts alerts that arrived, which are «جديد», and the panel
 * counts subscribers waiting for an answer, which are not new, they are waiting. One word for
 * both told a member of staff that two things had just happened when two things had been
 * sitting there since last week.
 */

export interface SectionLink {
  href: string;
  label: string;
  /** Other paths that belong to this place, beyond the ones under its own path. */
  also?: readonly string[];
  /** Matches its own path only. For a landing page whose path prefixes every other one. */
  exact?: boolean;
}

export interface PlaceLink extends SectionLink {
  icon: IconName;
}

export function isInSection(pathname: string, link: SectionLink): boolean {
  if (link.exact) {
    return pathname === link.href;
  }
  return [link.href, ...(link.also ?? [])].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function SectionNav({
  sections,
  label,
  counts = {},
  countLabel = 'جديد',
}: {
  sections: readonly PlaceLink[];
  label: string;
  /** A number to show beside a place, keyed by its href. */
  counts?: Readonly<Record<string, number>>;
  /**
   * What the number counts, read aloud after it and shown to nobody. The portal's word is the
   * default, because what the portal counts is alerts that arrived.
   */
  countLabel?: string;
}): ReactElement {
  const pathname = usePathname() ?? '';

  return (
    <nav aria-label={label} className="frame-nav">
      {sections.map((section) => {
        const count = counts[section.href] ?? 0;
        return (
          <Link
            key={section.href}
            href={section.href}
            className="frame-nav-item"
            {...(isInSection(pathname, section) ? { 'aria-current': 'page' as const } : {})}
          >
            <Icon name={section.icon} size={17} />
            <span>{section.label}</span>
            {count > 0 ? (
              <span className="frame-nav-count" data-role="nav-count">
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
