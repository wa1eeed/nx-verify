'use client';

import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';

/**
 * The navigation.
 *
 * Grouped by who is looking rather than by which part of the system a screen belongs to.
 * A compliance officer opens four of these every day and never opens the rest; a
 * developer opens only their own four. Mixing the two groups made a settings list of nine
 * items that nobody read to the end.
 *
 * Labels are the words a customer would use. "Registry" and "risk board" were our words
 * for them, and a person looking for their customers should not have to learn either.
 *
 * The current screen is marked with aria-current, so it is announced and not merely
 * tinted: colour on its own is not a label.
 */

export interface NavItem {
  href: string;
  label: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'العمل اليومي',
    items: [
      { href: '/dashboard', label: 'الرئيسية' },
      { href: '/registry', label: 'العملاء' },
      { href: '/onboarding', label: 'التأهيل' },
      { href: '/queue', label: 'المراجعات' },
      { href: '/portfolios', label: 'المجموعات' },
    ],
  },
  {
    label: 'الفوترة',
    items: [
      { href: '/usage', label: 'الباقة والرصيد' },
      { href: '/billing', label: 'كشف الحساب' },
    ],
  },
  {
    label: 'المطوّرون',
    items: [
      { href: '/settings/api-keys', label: 'مفاتيح الـAPI' },
      { href: '/developer', label: 'بيئة الاختبار' },
      { href: '/logs', label: 'سجل النداءات' },
      { href: '/docs', label: 'مرجع الـAPI' },
    ],
  },
  {
    label: 'الإعدادات',
    items: [
      { href: '/settings/users', label: 'المستخدمون' },
      { href: '/settings/rules', label: 'قواعد القرار' },
      { href: '/settings/freshness', label: 'مدد الصلاحية' },
      { href: '/settings/notifications', label: 'الإشعارات' },
      { href: '/support', label: 'الدعم' },
    ],
  },
];

export function Nav(): ReactElement {
  const pathname = usePathname();

  return (
    <nav aria-label="أقسام الكونسول" className="stack" style={{ gap: 'var(--s-5)' }}>
      {NAV.map((group) => (
        <div key={group.label} className="nav-group">
          <span className="nav-label">{group.label}</span>
          {group.items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="nav-link"
              {...(pathname === item.href ? { 'aria-current': 'page' as const } : {})}
            >
              {item.label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}
