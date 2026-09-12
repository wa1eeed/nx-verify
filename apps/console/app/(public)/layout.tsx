import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';

/**
 * The frame for a reader who has no account and never will.
 *
 * Nothing on this page is navigation. Someone who followed a shared link is here to read
 * one profile, and a menu offering them nine screens they cannot open would be an
 * invitation to try. The brand is here so the page is recognisably ours, because a
 * verification a reader cannot attribute is a verification they cannot rely on.
 */
export const metadata: Metadata = {
  // A shared profile is not a public document. It is addressed to one reader, and a
  // search engine is not that reader.
  robots: { index: false, follow: false, nocache: true },
};

export default function PublicLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="auth-frame" data-surface="public">
      <div className="brand auth-brand">
        <span className="brand-mark" aria-hidden="true">
          NX
        </span>
        <span>NX Trust</span>
      </div>
      <main id="main">{children}</main>
      <p className="faint auth-footnote">
        كل حقل في هذه الصفحة يحمل الجهة التي أصدرته وتاريخ رصده.
      </p>
    </div>
  );
}
