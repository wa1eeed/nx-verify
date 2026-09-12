import type { ReactElement, ReactNode } from 'react';
import { Nav } from '../components/nav';
import './tokens.css';

export const metadata = {
  title: 'NX Verify',
  description: 'منصة تحقق وامتثال',
};

/**
 * The shell.
 *
 * Full RTL, set at the document root rather than patched per component, and a fixed
 * navigation on the start side so a person always knows where they are without the page
 * reflowing under them.
 *
 * The fonts are the two named in CLAUDE.md: IBM Plex Sans Arabic for text and IBM Plex
 * Mono for identifiers, so that a run of digits keeps a fixed width and cannot be misread.
 */
export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Keyboard first: the navigation is long, and skipping it is the difference
            between usable and unusable for anyone not holding a mouse. */}
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
      </body>
    </html>
  );
}
