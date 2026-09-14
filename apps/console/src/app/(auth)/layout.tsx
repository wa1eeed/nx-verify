import type { ReactElement, ReactNode } from 'react';
import { Brand } from '../../components/brand';

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
      <Brand />
      <main id="main">{children}</main>
      <p className="faint auth-footnote">منصة تحقق وامتثال · جميع الحقول تحمل جهتها وتاريخ رصدها</p>
    </div>
  );
}
