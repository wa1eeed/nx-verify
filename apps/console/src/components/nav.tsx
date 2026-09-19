import type { ReactElement } from 'react';
import type { Capability } from '@nx-verify/core';
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
 *
 * Every entry carries the permission it needs, and `visible` drops the ones this person does
 * not hold. Somebody in finance sees the balance and the invoices and nothing about
 * customers: not a greyed out tab that refuses them, which is a locked door with their name
 * on it, but a navigation that is simply the size of their job.
 */

type Gated<T> = T & { needs?: Capability };

export const SECTIONS: readonly Gated<PlaceLink>[] = [
  { href: '/dashboard', label: 'اللوحة الرئيسية', icon: 'layout-dashboard' },
  { href: '/customers', label: 'العملاء', icon: 'users', needs: 'customers.read' },
  { href: '/verifications', label: 'التحقق', icon: 'badge-check', needs: 'customers.read' },
  { href: '/billing', label: 'الاشتراك والرصيد', icon: 'wallet', needs: 'wallet.read' },
  { href: '/settings', label: 'الإعدادات', icon: 'settings' },
];

export const CUSTOMER_TABS: readonly Gated<SectionTab>[] = [
  { href: '/customers', label: 'قائمة العملاء' },
  { href: '/customers/parties', label: 'الأطراف ذات العلاقة' },
  { href: '/customers/relations', label: 'التقاطعات والعلاقات' },
  { href: '/customers/alerts', label: 'التنبيهات المفتوحة' },
  { href: '/customers/monitoring', label: 'المراقبة' },
  { href: '/customers/reviews', label: 'بانتظار قرار', needs: 'review.decide' },
];

export const VERIFICATION_TABS: readonly Gated<SectionTab>[] = [
  { href: '/verifications/new', label: 'طلب تحقق جديد', needs: 'verify.run' },
  { href: '/verifications', label: 'سجل العمليات' },
  { href: '/verifications/failed', label: 'العمليات المتعثرة' },
  { href: '/verifications/onboarding', label: 'ملفات التأهيل' },
  { href: '/verifications/evidence', label: 'فحص مستند' },
];

export const BILLING_TABS: readonly Gated<SectionTab>[] = [
  { href: '/billing', label: 'الباقة والرصيد' },
  { href: '/billing/invoices', label: 'الفواتير والإيصالات' },
  { href: '/billing/prices', label: 'أسعار المنتجات' },
];

export const SETTINGS_TABS: readonly Gated<SectionTab>[] = [
  { href: '/settings', label: 'المستخدمون والصلاحيات' },
  { href: '/settings/notifications', label: 'التنبيهات والإشعارات', needs: 'settings.manage' },
  {
    href: '/settings/developers',
    label: 'مفاتيح الربط والـ Webhooks',
    needs: 'developers.manage',
  },
  { href: '/settings/rules', label: 'قواعد القرار', needs: 'rules.manage' },
  { href: '/settings/portfolios', label: 'المجموعات', needs: 'settings.manage' },
  { href: '/settings/freshness', label: 'مدد الصلاحية', needs: 'settings.manage' },
  { href: '/settings/sso', label: 'الدخول الموحّد', needs: 'settings.manage' },
  { href: '/settings/audit', label: 'سجل التدقيق', needs: 'audit.read' },
  { href: '/settings/support', label: 'الدعم' },
];

/** The keys and webhooks tab holds four screens of its own. */
export const DEVELOPER_TABS: readonly Gated<SectionTab>[] = [
  { href: '/settings/developers', label: 'مفاتيح الـAPI' },
  { href: '/settings/developers/webhooks', label: 'الـ Webhooks' },
  { href: '/settings/developers/sandbox', label: 'بيئة الاختبار' },
  { href: '/settings/developers/logs', label: 'سجل النداءات' },
  { href: '/settings/developers/reference', label: 'مرجع الـAPI' },
];

/** Drops the entries this person has no permission to open. */
export function visible<T extends { needs?: Capability }>(
  entries: readonly T[],
  held: ReadonlySet<Capability>,
): T[] {
  return entries.filter((entry) => entry.needs === undefined || held.has(entry.needs));
}

export function Nav({
  alerts = 0,
  capabilities,
}: {
  alerts?: number;
  capabilities: ReadonlySet<Capability>;
}): ReactElement {
  return (
    <SectionNav
      sections={visible(SECTIONS, capabilities)}
      label="أقسام المنصة"
      counts={alerts > 0 ? { '/customers': alerts } : {}}
    />
  );
}
