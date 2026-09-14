import type { ReactElement, ReactNode } from 'react';
import { classes } from './classes';

/**
 * A surface-filled card (`.card`), rounded as the screens ask.
 *
 * `panel` is a section of a screen, 28px round with the section padding. `stat` is one of
 * the figures along the top of a screen, 26px round. `plain` keeps the sheet's own padding.
 * The tone is a role, not a colour: the ground, the accent tint behind a risk, the sage tint
 * behind a package, or the attention card of the administration panel.
 */

export type CardVariant = 'panel' | 'stat' | 'plain';
export type CardTone = 'surface' | 'ground' | 'accent' | 'accent-2' | 'attention';

export function Card({
  as: Element = 'section',
  variant = 'panel',
  tone = 'surface',
  elevation,
  id,
  role,
  label,
  labelledBy,
  children,
}: {
  as?: 'section' | 'article' | 'aside' | 'div' | undefined;
  variant?: CardVariant | undefined;
  tone?: CardTone | undefined;
  elevation?: 'sm' | 'md' | 'lg' | undefined;
  /** An anchor another part of the screen links to, such as the risk reasons. */
  id?: string | undefined;
  /** A name for tests and styles to find the card by, written as data-role. */
  role?: string | undefined;
  label?: string | undefined;
  labelledBy?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <Element
      id={id}
      data-role={role}
      className={classes(
        'card',
        `card-${variant}`,
        tone !== 'surface' && `card-tone-${tone}`,
        elevation !== undefined && `elev-${elevation}`,
      )}
      aria-label={label}
      aria-labelledby={labelledBy}
    >
      {children}
    </Element>
  );
}

export function CardTitle({
  as: Heading = 'h3',
  id,
  children,
}: {
  as?: 'h1' | 'h2' | 'h3' | 'h4' | undefined;
  id?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <Heading className="card-title" id={id}>
      {children}
    </Heading>
  );
}

export function CardKicker({ children }: { children: ReactNode }): ReactElement {
  return <p className="card-kicker">{children}</p>;
}

export function CardBody({ children }: { children: ReactNode }): ReactElement {
  return <div className="card-body">{children}</div>;
}

export function CardMeta({ children }: { children: ReactNode }): ReactElement {
  return <div className="card-meta">{children}</div>;
}
