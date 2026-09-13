import type { ReactElement, ReactNode } from 'react';
import { SectionNav, type SectionLink } from './section-nav';
import type { SectionTab } from './section-tabs';

/**
 * The frame of the administration panel.
 *
 * It shares nothing with a subscriber's console except the stylesheet: not the session,
 * not the navigation, not the database role. Before this, the panel's screens rendered
 * inside the subscriber shell, so reaching them needed a subscriber session as well as the
 * operator token, and the sidebar beside a pricing screen listed a customer's files. Two
 * audiences on one frame is how a screen meant for one ends up in front of the other.
 *
 * Five sections, each answering one question somebody running the platform asks: how is
 * it going, who is paying, what do we sell and for how much, whose money arrived, and is
 * the connection to the data source healthy.
 */

export const OPERATOR_SECTIONS: readonly SectionLink[] = [
  { href: '/operator', label: 'نظرة عامة', exact: true },
  { href: '/operator/tenants', label: 'المشتركون' },
  { href: '/operator/packages', label: 'الباقات والأسعار', also: ['/operator/margin'] },
  { href: '/operator/topups', label: 'الحوالات' },
  {
    href: '/operator/connections',
    label: 'الربط التقني',
    also: ['/operator/endpoints', '/operator/health', '/operator/readiness'],
  },
];

export const PRICING_TABS: readonly SectionTab[] = [
  { href: '/operator/packages', label: 'الباقات' },
  { href: '/operator/margin', label: 'الهامش' },
];

export const INTEGRATION_TABS: readonly SectionTab[] = [
  { href: '/operator/connections', label: 'بيانات الربط' },
  { href: '/operator/endpoints', label: 'نقاط النهاية' },
  { href: '/operator/health', label: 'صحة الخدمة' },
  { href: '/operator/readiness', label: 'جاهزية النشر' },
];

export function OperatorShell({
  operatorId,
  children,
}: {
  operatorId: string;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <a className="skip-link" href="#main">
        تخطَّ إلى المحتوى
      </a>

      <div className="shell" data-surface="operator">
        <aside className="sidebar">
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                NX
              </span>
              <span>NX Trust</span>
            </div>
            <span className="surface-label" data-role="surface-label">
              لوحة الإدارة
            </span>
          </div>
          <SectionNav sections={OPERATOR_SECTIONS} label="أقسام لوحة الإدارة" />
        </aside>

        <div>
          <header className="topbar">
            <div className="topbar-workspace">
              <strong>لوحة الإدارة</strong>
              <bdi dir="ltr" className="mono muted" data-role="operator-id">
                {operatorId}
              </bdi>
            </div>
            <form action="/operator/logout" method="post" className="inline">
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
