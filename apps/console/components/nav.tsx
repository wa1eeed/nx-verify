'use client';

import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';

/**
 * The navigation, grouped by what a person came here to do.
 *
 * Grouped rather than listed, because seven flat links make somebody read all seven every
 * time. Watching, working and configuring are three different reasons to be here.
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
    label: 'المتابعة',
    items: [
      { href: '/dashboard', label: 'لوحة المخاطر' },
      { href: '/registry', label: 'السجل' },
    ],
  },
  {
    label: 'العمل',
    items: [
      { href: '/onboarding', label: 'ملفات التأهيل' },
      { href: '/queue', label: 'طابور المراجعة' },
      { href: '/portfolios', label: 'المحافظ' },
    ],
  },
  {
    label: 'الاشتراك',
    items: [
      { href: '/usage', label: 'الاستهلاك والباقة' },
      { href: '/billing', label: 'كشف الاستهلاك' },
    ],
  },
  {
    label: 'الإعدادات',
    items: [
      { href: '/developer', label: 'بيئة المطوّر' },
      { href: '/docs', label: 'المرجع' },
      { href: '/logs', label: 'سجل النداءات' },
      { href: '/support', label: 'الدعم' },
      { href: '/settings/api-keys', label: 'مفاتيح الـAPI' },
      { href: '/settings/freshness', label: 'مدد الصلاحية' },
      { href: '/settings/rules', label: 'قواعد القرار' },
      { href: '/settings/notifications', label: 'التنبيهات' },
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
