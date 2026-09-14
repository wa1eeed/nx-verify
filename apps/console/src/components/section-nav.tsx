'use client';

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
}: {
  sections: readonly PlaceLink[];
  label: string;
  /** A number to show beside a place, keyed by its href. */
  counts?: Readonly<Record<string, number>>;
}): ReactElement {
  const pathname = usePathname() ?? '';

  return (
    <nav aria-label={label} className="frame-nav">
      {sections.map((section) => {
        const count = counts[section.href] ?? 0;
        return (
          <a
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
                <span className="visually-hidden"> جديد</span>
              </span>
            ) : null}
          </a>
        );
      })}
    </nav>
  );
}
