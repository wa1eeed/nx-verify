import type { ReactElement, ReactNode } from 'react';

/**
 * The head of every screen: what this is, and what to do about it (README, screen 01).
 *
 * A 32px title with one line under it in the neutral ramp, and the actions facing it across
 * the row. One primary action, because the interface rules allow one per screen; a header
 * that offers three has not decided what the screen is for.
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}): ReactElement {
  return (
    <header className="page-head" data-role="page-header">
      <div className="page-head-text">
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {action ? <div className="page-head-actions">{action}</div> : null}
    </header>
  );
}

/** A bordered region with a name on it. */
export function Panel({
  title,
  aside,
  note,
  children,
  role,
}: {
  title: string;
  aside?: ReactNode;
  /**
   * A rule that governs what is in this panel.
   *
   * Sits here rather than in the page subtitle. A subtitle answers "what is this screen",
   * and a rule crammed into it competes with that and loses: the reader skips both.
   */
  note?: string;
  children: ReactNode;
  role?: string;
}): ReactElement {
  return (
    <section className="panel" {...(role ? { 'data-role': role } : {})}>
      <div className="panel-header">
        <h2>{title}</h2>
        {aside ? <span className="muted">{aside}</span> : null}
      </div>
      {note ? (
        <p className="faint panel-note" data-role="panel-note">
          {note}
        </p>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Nothing here, said in a way that tells the reader whether that is good news.
 *
 * An empty review queue is good news. An empty registry means nobody has verified
 * anything yet. The same blank table cannot say both, so the caller says which.
 */
export function EmptyState({
  children,
  action,
}: {
  children: ReactNode;
  /** The one thing to do about it (README, states: guidance and the primary action). */
  action?: ReactNode;
}): ReactElement {
  return action === undefined ? (
    <p className="empty" data-role="empty-state">
      {children}
    </p>
  ) : (
    <div className="empty empty-with-action" data-role="empty-state">
      <p>{children}</p>
      {action}
    </div>
  );
}
