import type { ReactElement } from 'react';
import { SectionNav, type SectionLink } from './section-nav';
import type { SectionTab } from './section-tabs';

/**
 * The navigation: seven places, each a question a subscriber comes with.
 *
 * The owner's complaint about the previous navigation was that its sections repeated one
 * another and did not say what they were for. It listed fifteen screens under four headings,
 * so the same work was split across several links ("customers", "onboarding", "reviews",
 * "portfolios") and a person had to know the system to know where to click.
 *
 * Now the sidebar lists places, and the screens inside a place are its tabs:
 *
 *   الرئيسية        what needs attention today
 *   العملاء         every customer file, and adding one
 *   عمليات التحقق   every verification that ran, and the ones waiting for a decision
 *   المراقبة        what changed since the last check, and when facts go stale
 *   الفوترة         the package, the balance, and the statement
 *   المطوّرون       keys, sandbox, call log and the API reference
 *   الإعدادات       team, decision rules, groups, notification channels, support
 *
 * Labels are the words a customer would use, and a place stays marked on every one of its
 * tabs so moving between them never looks like leaving.
 */

export const SECTIONS: readonly SectionLink[] = [
  { href: '/dashboard', label: 'الرئيسية' },
  { href: '/customers', label: 'العملاء' },
  { href: '/verifications', label: 'عمليات التحقق' },
  { href: '/monitoring', label: 'المراقبة' },
  { href: '/billing', label: 'الفوترة' },
  { href: '/developers', label: 'المطوّرون' },
  { href: '/settings', label: 'الإعدادات' },
];

export const VERIFICATION_TABS: readonly SectionTab[] = [
  { href: '/verifications', label: 'كل العمليات' },
  { href: '/verifications/reviews', label: 'بانتظار قرار' },
  { href: '/verifications/onboarding', label: 'ملفات التأهيل' },
];

export const MONITORING_TABS: readonly SectionTab[] = [
  { href: '/monitoring', label: 'التغيّرات والتنبيهات' },
  { href: '/monitoring/freshness', label: 'مدد الصلاحية' },
];

export const BILLING_TABS: readonly SectionTab[] = [
  { href: '/billing', label: 'الباقة والرصيد' },
  { href: '/billing/statement', label: 'كشف الحساب والشحن' },
];

export const DEVELOPER_TABS: readonly SectionTab[] = [
  { href: '/developers', label: 'مفاتيح الـAPI' },
  { href: '/developers/sandbox', label: 'بيئة الاختبار' },
  { href: '/developers/logs', label: 'سجل النداءات' },
  { href: '/developers/reference', label: 'مرجع الـAPI' },
];

export const SETTINGS_TABS: readonly SectionTab[] = [
  { href: '/settings', label: 'الفريق' },
  { href: '/settings/rules', label: 'قواعد القرار' },
  { href: '/settings/portfolios', label: 'المجموعات' },
  { href: '/settings/notifications', label: 'قنوات الإشعار' },
  { href: '/settings/support', label: 'الدعم' },
];

export function Nav(): ReactElement {
  return <SectionNav sections={SECTIONS} label="أقسام المنصة" />;
}
