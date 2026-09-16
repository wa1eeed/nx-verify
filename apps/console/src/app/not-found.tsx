import type { ReactElement } from 'react';
import { Brand } from '../components/brand';
import { ButtonLink } from '../components/ui/button';

/**
 * Never prerendered, alone among the screens for a reason (SEC-03).
 *
 * A page built once at build time carries the scripts it was built with, and none of them
 * carries the nonce of the response that serves it, so the policy refuses every one and the
 * screen arrives without its own code. Rendered per request, it is stamped like the rest.
 */
export const dynamic = 'force-dynamic';

/** An address that leads nowhere: say so, and offer the way back. */
export default function NotFound(): ReactElement {
  return (
    <div className="auth-frame">
      <Brand />
      <main id="main" className="stack" style={{ gap: 'var(--s-4)', alignItems: 'center' }}>
        <h1 className="page-title">الصفحة غير موجودة</h1>
        <p style={{ margin: 0 }}>العنوان الذي فتحته لا يقود إلى شاشة في المنصة.</p>
        <ButtonLink href="/dashboard" variant="primary">
          العودة إلى اللوحة الرئيسية
        </ButtonLink>
      </main>
    </div>
  );
}
