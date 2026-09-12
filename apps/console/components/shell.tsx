import type { ReactElement, ReactNode } from 'react';
import { Nav } from './nav';

/**
 * The shell every working screen sits in.
 *
 * Presentation only, and that is deliberate: the layout above it reads which workspace
 * this is, and this renders it. Keeping the query out means the shell can be rendered and
 * asserted without a database, which is how the interface rules stay tested.
 *
 * A fixed navigation on the start side so a person always knows where they are without
 * the page reflowing under them, and a skip link before it, because the navigation is
 * long and skipping it is the difference between usable and unusable for anyone not
 * holding a mouse.
 */
export function Shell({
  isSandbox,
  children,
}: {
  isSandbox: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <a className="skip-link" href="#main">
        تخطَّ إلى المحتوى
      </a>

      {/* A band that cannot be closed. A person who forgets which world they are in draws
          conclusions from test data, and the sandbox exists because its data means
          nothing. */}
      {isSandbox ? (
        <div className="env-banner" data-role="sandbox-banner" role="status">
          بيئة اختبار. البيانات هنا من مزوّد وهمي ولا تثبت شيئاً، والمستندات المختومة فيها موسومة.
        </div>
      ) : null}

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
              <span className="muted" data-role="environment-name">
                {isSandbox ? 'بيئة الاختبار' : 'بيئة الإنتاج'}
              </span>
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
