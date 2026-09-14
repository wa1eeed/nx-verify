import type { ReactElement } from 'react';
import { SectionNav, type PlaceLink } from './section-nav';
import type { SectionTab } from './section-tabs';

/**
 * The subscriber's navigation (handoff screen 00): the home screen and four places.
 *
 * The places answer the questions a subscriber comes with, not the parts of the system:
 * who is the customer, what did I verify, what is left in my balance, how do I set up the
 * account. Everything else lives inside one of them, as a tab.
 *
 *   اللوحة الرئيسية     the balance, the package, the latest operations, a quick start
 *   العملاء             the list and search, each customer's file, links, open alerts
 *   التحقق              a new request, full or one product, the log, the ones that failed
 *   الاشتراك والرصيد    the package and its end, the balance, invoices, product prices
 *   الإعدادات           people and permissions, notifications, keys and webhooks, rules
 *
 * A place stays marked on every one of its tabs, so moving between them never looks like
 * leaving.
 */

export const SECTIONS: readonly PlaceLink[] = [
  { href: '/dashboard', label: 'اللوحة الرئيسية', icon: 'layout-dashboard' },
  { href: '/customers', label: 'العملاء', icon: 'users' },
  { href: '/verifications', label: 'التحقق', icon: 'badge-check' },
  { href: '/billing', label: 'الاشتراك والرصيد', icon: 'wallet' },
  { href: '/settings', label: 'الإعدادات', icon: 'settings' },
];

export const CUSTOMER_TABS: readonly SectionTab[] = [
  { href: '/customers', label: 'قائمة العملاء' },
  { href: '/customers/relations', label: 'التقاطعات والعلاقات' },
  { href: '/customers/alerts', label: 'التنبيهات المفتوحة' },
  { href: '/customers/reviews', label: 'بانتظار قرار' },
];

export const VERIFICATION_TABS: readonly SectionTab[] = [
  { href: '/verifications/new', label: 'طلب تحقق جديد' },
  { href: '/verifications', label: 'سجل العمليات' },
  { href: '/verifications/failed', label: 'العمليات المتعثرة' },
  { href: '/verifications/onboarding', label: 'ملفات التأهيل' },
];

export const BILLING_TABS: readonly SectionTab[] = [
  { href: '/billing', label: 'الباقة والرصيد' },
  { href: '/billing/invoices', label: 'الفواتير والإيصالات' },
  { href: '/billing/prices', label: 'أسعار المنتجات' },
];

export const SETTINGS_TABS: readonly SectionTab[] = [
  { href: '/settings', label: 'المستخدمون والصلاحيات' },
  { href: '/settings/notifications', label: 'التنبيهات والإشعارات' },
  { href: '/settings/developers', label: 'مفاتيح الربط والـ Webhooks' },
  { href: '/settings/rules', label: 'قواعد القرار' },
  { href: '/settings/portfolios', label: 'المجموعات' },
  { href: '/settings/freshness', label: 'مدد الصلاحية' },
  { href: '/settings/support', label: 'الدعم' },
];

/** The keys and webhooks tab holds four screens of its own. */
export const DEVELOPER_TABS: readonly SectionTab[] = [
  { href: '/settings/developers', label: 'مفاتيح الـAPI' },
  { href: '/settings/developers/sandbox', label: 'بيئة الاختبار' },
  { href: '/settings/developers/logs', label: 'سجل النداءات' },
  { href: '/settings/developers/reference', label: 'مرجع الـAPI' },
];

export function Nav({ alerts = 0 }: { alerts?: number }): ReactElement {
  return (
    <SectionNav
      sections={SECTIONS}
      label="أقسام المنصة"
      counts={alerts > 0 ? { '/customers': alerts } : {}}
    />
  );
}
