import type { ReactElement, ReactNode } from 'react';
import './tokens.css';

export const metadata = {
  title: 'NX Verify',
  description: 'منصة تحقق وامتثال',
};

/**
 * Full RTL, set at the document root rather than patched per component.
 *
 * The fonts are the two named in CLAUDE.md: IBM Plex Sans Arabic for text and IBM Plex
 * Mono for identifiers, so that a run of digits keeps a fixed width and cannot be misread.
 */
export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="header">
          <nav className="row">
            <strong>NX Verify</strong>
            <a href="/registry">السجل</a>
            <a href="/settings/freshness">مدد الصلاحية</a>
          </nav>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
