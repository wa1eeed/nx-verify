import type { ReactElement, ReactNode } from 'react';
import './tokens.css';

export const metadata = {
  title: 'NX Verify',
  description: 'منصة تحقق وامتثال',
};

/**
 * The document.
 *
 * Full RTL, set at the root rather than patched per component, and the two fonts named in
 * CLAUDE.md: IBM Plex Sans Arabic for text and IBM Plex Mono for identifiers, so a run of
 * digits keeps a fixed width and cannot be misread.
 *
 * The furniture lives one level down, in two groups. A person who is signed in gets the
 * shell; a person who is not gets a bare page, because navigation to screens they cannot
 * open and a sign out button for a session they do not have are both lies.
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
      <body>{children}</body>
    </html>
  );
}
