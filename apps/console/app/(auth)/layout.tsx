import type { ReactElement, ReactNode } from 'react';

/**
 * The frame for someone who is not signed in yet.
 *
 * No navigation and no sign out: offering either to a visitor with no session states
 * something untrue about what they can do. The brand is here so the page is recognisably
 * ours before anyone has proved who they are.
 */
export default function AuthLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="auth-frame">
      <div className="brand auth-brand">
        <span className="brand-mark" aria-hidden="true">
          NX
        </span>
        <span>NX Trust</span>
      </div>
      <main id="main">{children}</main>
      <p className="faint auth-footnote">منصة تحقق وامتثال · جميع الحقول تحمل جهتها وتاريخ رصدها</p>
    </div>
  );
}
