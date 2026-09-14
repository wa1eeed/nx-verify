import type { ReactElement } from 'react';
import { Brand } from '../components/brand';
import { ButtonLink } from '../components/ui/button';

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
