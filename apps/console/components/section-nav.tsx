'use client';

import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';

/**
 * A short list of sections, one of which is open.
 *
 * A section is a place a person goes, and the screens inside it are its tabs. Listing
 * every screen in the sidebar is what made the old navigation read like an index: fifteen
 * links, several saying nearly the same thing, and no way to tell which ones mattered.
 * A section stays marked on every one of its tabs, so moving between them never looks
 * like leaving.
 *
 * The open section carries aria-current, so it is announced and not merely tinted.
 */

export interface SectionLink {
  href: string;
  label: string;
  /** Other paths that belong to this section, such as its tabs. */
  also?: readonly string[];
  /** Matches its own path only. For a landing page whose path prefixes every other one. */
  exact?: boolean;
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
}: {
  sections: readonly SectionLink[];
  label: string;
}): ReactElement {
  const pathname = usePathname() ?? '';

  return (
    <nav aria-label={label} className="nav-group">
      {sections.map((section) => (
        <a
          key={section.href}
          href={section.href}
          className="nav-link"
          {...(isInSection(pathname, section) ? { 'aria-current': 'page' as const } : {})}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
