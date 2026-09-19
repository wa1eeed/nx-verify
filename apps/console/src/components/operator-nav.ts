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
  // A subscriber can ask for a test workspace now, and the ask has to land somewhere a member
  // of staff will see it. A screen reachable only by typing its address is the same as the
  // support link it replaces (ADR-173).
  { href: '/operator/subscribers/sandboxes', label: 'مساحات الاختبار' },
];

/** What the platform sells: its prices, and the modules those prices are grouped into. */
export const PRICING_TABS: readonly SectionTab[] = [
  { href: '/operator/pricing', label: 'الأسعار والمنتجات' },
  // The number every other number here is arithmetic on, and the panel had no tab for it at
  // all: the rates came from a seed file, so the margin was right only while that file
  // matched the contract (ADR-166).
  { href: '/operator/pricing/costs', label: 'تكاليف المزودين' },
  // Reachable only by a link from the pricing screen until now, so the navigation showed
  // nothing selected once you arrived and there was no way back but the browser.
  { href: '/operator/pricing/plans', label: 'الباقات والاشتراكات' },
  // «الموديولات» was a transliteration in an Arabic interface, and the subscriber's own
  // screens call the same thing «وحدات التحقق».
  { href: '/operator/pricing/modules', label: 'وحدات التحقق' },
];

/** Verification settings, and the connection to the data source behind them. */
export const INTEGRATION_TABS: readonly SectionTab[] = [
  { href: '/operator/verification', label: 'الإعدادات' },
  { href: '/operator/verification/integration', label: 'الربط التقني' },
  { href: '/operator/verification/routing', label: 'المزودون والخدمات' },
  { href: '/operator/verification/risk', label: 'مؤشرات المخاطر' },
  { href: '/operator/verification/mail', label: 'البريد' },
  { href: '/operator/verification/endpoints', label: 'نقاط النهاية' },
  { href: '/operator/verification/callbacks', label: 'النداءات الواردة' },
  { href: '/operator/verification/keys', label: 'إصدارات المفاتيح' },
  { href: '/operator/verification/health', label: 'صحة الخدمة' },
  { href: '/operator/verification/readiness', label: 'جاهزية النشر' },
];

/**
 * Screens reached from a link on their place's own screen rather than from the navigation:
 * what each plan sells, opened from the plans card of screen 05.
 */
export const SCREEN_LINKED_PAGES: readonly string[] = ['/operator/pricing/plans'];
