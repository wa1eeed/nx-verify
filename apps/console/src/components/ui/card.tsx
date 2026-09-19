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

export type CardVariant = 'panel' | 'stat' | 'plain' | 'flush';
export type CardTone = 'surface' | 'ground' | 'accent' | 'accent-2' | 'attention';

export function Card({
  as: Element = 'section',
  variant = 'panel',
  tone = 'surface',
  elevation,
  id,
  role,
  item,
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
  /**
   * Which one of its kind this card is, written as data-item: the module, the service, the
   * plan. A screen that repeats a card needs a way to name each, and a data attribute passed
   * to a component that drops it is a test that silently matches nothing.
   */
  item?: string | undefined;
  label?: string | undefined;
  labelledBy?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <Element
      id={id}
      data-role={role}
      data-item={item}
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
  size,
  id,
  children,
}: {
  as?: 'h1' | 'h2' | 'h3' | 'h4' | undefined;
  /**
   * `section` is the larger title a card carries when it is a whole section of a screen
   * rather than one of several cards in a row. Left unset the title is the sheet's own.
   */
  size?: 'section' | undefined;
  id?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <Heading className={classes('card-title', size === 'section' && 'admin-card-title')} id={id}>
      {children}
    </Heading>
  );
}

/** A rule or a count that qualifies what is in the card, under or beside its name. */
export function CardNote({
  role,
  children,
}: {
  role?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <p className="admin-card-note" data-role={role}>
      {children}
    </p>
  );
}

/**
 * The head of a card that is a whole section: its name, what is in it, and the labels that
 * qualify it.
 *
 * The heading is an `h2` because the screen's own title is the `h1` above it, and a section
 * whose name is not a heading is a section no screen reader can jump to.
 */
export function CardHead({
  title,
  titleId,
  note,
  children,
}: {
  title: ReactNode;
  /** The id the card points at with `labelledBy`, so the card is named by its own heading. */
  titleId?: string | undefined;
  note?: ReactNode;
  /** The labels facing the name across the row, such as a plan's code and its term. */
  children?: ReactNode;
}): ReactElement {
  return (
    <div className="admin-card-head">
      <CardTitle as="h2" size="section" id={titleId}>
        {title}
      </CardTitle>
      {note === undefined || note === null ? null : <CardNote>{note}</CardNote>}
      {children === undefined || children === null ? null : (
        <div className="admin-head-actions">{children}</div>
      )}
    </div>
  );
}

/**
 * Nothing in this card, said in the card's own padding.
 *
 * A card that renders an empty table instead leaves the reader deciding whether the screen
 * is broken or the answer is genuinely none, and the words are the only thing that settles
 * it: an empty queue is good news and an empty registry is not.
 */
export function CardEmpty({
  role = 'empty-state',
  children,
}: {
  role?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <p className="admin-empty" data-role={role}>
      {children}
    </p>
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
