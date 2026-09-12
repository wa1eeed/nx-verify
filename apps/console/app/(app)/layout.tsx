import type { ReactElement, ReactNode } from 'react';
import { Nav } from '../../components/nav';

/**
 * The shell every working screen sits in.
 *
 * A fixed navigation on the start side so a person always knows where they are without
 * the page reflowing under them, and a skip link before it, because the navigation is
 * long and skipping it is the difference between usable and unusable for anyone not
 * holding a mouse.
 */
export default function AppLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <>
      <a className="skip-link" href="#main">
        تخطَّ إلى المحتوى
      </a>

      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              NX
            </span>
            <span>NX Verify</span>
          </div>
          <Nav />
        </aside>

        <div>
          <header className="topbar">
            <div className="topbar-workspace">
              <strong>مساحة العمل</strong>
              <span className="muted">التحقق والامتثال</span>
            </div>
            <form action="/logout" method="post" className="inline">
              <button type="submit" className="link" data-role="sign-out">
                خروج
              </button>
            </form>
          </header>

          <main className="page" id="main">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
