import type { PlaceLink } from './section-nav';
import type { SectionTab } from './section-tabs';

/**
 * The administration panel's places and tabs, apart from its frame.
 *
 * Kept free of the domain package, so the loading screens in the browser can name where a
 * member of staff is going without shipping the domain to the browser with them.
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

/** What the platform sells: its prices, and the modules those prices are grouped into. */
export const PRICING_TABS: readonly SectionTab[] = [
  { href: '/operator/pricing', label: 'الأسعار والمنتجات' },
  { href: '/operator/pricing/modules', label: 'الموديولات' },
];

/** Verification settings, and the connection to the data source behind them. */
export const INTEGRATION_TABS: readonly SectionTab[] = [
  { href: '/operator/verification', label: 'الإعدادات' },
  { href: '/operator/verification/integration', label: 'الربط التقني' },
  { href: '/operator/verification/routing', label: 'المزودون والخدمات' },
  { href: '/operator/verification/endpoints', label: 'نقاط النهاية' },
  { href: '/operator/verification/health', label: 'صحة الخدمة' },
  { href: '/operator/verification/readiness', label: 'جاهزية النشر' },
];

/**
 * Screens reached from a link on their place's own screen rather than from the navigation:
 * what each plan sells, opened from the plans card of screen 05.
 */
export const SCREEN_LINKED_PAGES: readonly string[] = ['/operator/pricing/plans'];
