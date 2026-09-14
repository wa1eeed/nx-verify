import type { ReactElement, ReactNode } from 'react';
import { OPERATOR_ROLE_LABELS, type OperatorIdentity } from '@nx-verify/core';
import { Brand } from './brand';
import { SectionNav, type PlaceLink } from './section-nav';
import type { SectionTab } from './section-tabs';
import { Button } from './ui/button';

/**
 * The frame of the administration panel (handoff screens 05 and 06).
 *
 * Dark on purpose, so staff never mistake it for a subscriber's portal, and it shares
 * nothing with that portal except the component layer: not the session, not the
 * navigation, not the database role.
 *
 * Six places, each a question somebody running the platform asks: how is it going, who is
 * subscribed and what is left in their balance, what do we sell and for how much, how does
 * verification behave and is the data source connected, what did it earn, and who changed
 * what.
 */

export const OPERATOR_SECTIONS: readonly PlaceLink[] = [
  { href: '/operator', label: 'نظرة عامة', exact: true, icon: 'layout-dashboard' },
  { href: '/operator/subscribers', label: 'المشتركون', icon: 'building-2' },
  { href: '/operator/pricing', label: 'الأسعار والمنتجات', icon: 'tag' },
  { href: '/operator/verification', label: 'إعدادات التحقق', icon: 'sliders-horizontal' },
  { href: '/operator/reports', label: 'التقارير', icon: 'bar-chart-3' },
  { href: '/operator/access', label: 'الصلاحيات والتدقيق', icon: 'shield' },
];

export const SUBSCRIBER_TABS: readonly SectionTab[] = [
  { href: '/operator/subscribers', label: 'المشتركون والأرصدة' },
  { href: '/operator/subscribers/topups', label: 'الحوالات' },
];

/** Verification settings, and the connection to the data source behind them. */
export const INTEGRATION_TABS: readonly SectionTab[] = [
  { href: '/operator/verification', label: 'الإعدادات' },
  { href: '/operator/verification/integration', label: 'الربط التقني' },
  { href: '/operator/verification/endpoints', label: 'نقاط النهاية' },
  { href: '/operator/verification/health', label: 'صحة الخدمة' },
  { href: '/operator/verification/readiness', label: 'جاهزية النشر' },
];

/**
 * Screens reached from a link on their place's own screen rather than from the navigation:
 * what each plan sells, opened from the plans card of screen 05.
 */
export const SCREEN_LINKED_PAGES: readonly string[] = ['/operator/pricing/plans'];

export function OperatorShell({
  operator,
  children,
}: {
  /** Who is signed in: their name and their role, never their address. */
  operator: OperatorIdentity;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <a className="skip-link" href="#main">
        تخطَّ إلى المحتوى
      </a>

      <div className="frame" data-theme="dark" data-surface="operator">
        <aside className="frame-sidebar">
          <div className="frame-sidebar-inner">
            <Brand href="/operator" suffix="أدمن" />
            <SectionNav sections={OPERATOR_SECTIONS} label="أقسام لوحة الإدارة" />

            <div className="frame-sidebar-foot">
              <div className="frame-account">
                <span className="frame-account-name" data-role="operator-name">
                  {operator.displayName}
                  <span className="frame-account-role" data-role="operator-role">
                    {OPERATOR_ROLE_LABELS[operator.role]}
                  </span>
                </span>
                <form action="/operator/logout" method="post" className="inline">
                  <Button type="submit" variant="ghost" data-role="sign-out">
                    خروج
                  </Button>
                </form>
              </div>
            </div>
          </div>
        </aside>

        <main className="frame-main" id="main">
          {children}
        </main>
      </div>
    </>
  );
}
