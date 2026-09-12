import type { ReactElement, ReactNode } from 'react';

/**
 * The head of every screen: what this is, and one thing to do about it.
 *
 * One action, because the interface rules allow one primary button per screen. A header
 * that offers three is a header that has not decided what the screen is for.
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
    <header className="page-header" data-role="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="row">{action}</div> : null}
    </header>
  );
}

/** A bordered region with a name on it. */
export function Panel({
  title,
  aside,
  children,
  role,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  role?: string;
}): ReactElement {
  return (
    <section className="panel" {...(role ? { 'data-role': role } : {})}>
      <div className="panel-header">
        <h2>{title}</h2>
        {aside ? <span className="muted">{aside}</span> : null}
      </div>
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
export function EmptyState({ children }: { children: ReactNode }): ReactElement {
  return (
    <p className="empty" data-role="empty-state">
      {children}
    </p>
  );
}
