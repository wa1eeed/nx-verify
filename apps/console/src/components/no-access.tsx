import Link from 'next/link';
import type { ReactElement } from 'react';
import { capabilityInfo, type Capability } from '@nx-verify/core';
import { PageHeader } from './page-header';

/**
 * A screen somebody may not open.
 *
 * It says which permission is missing and who can grant it, because the alternative is an
 * employee messaging their manager with «الصفحة ما تفتح» and neither of them knowing what to
 * change. Naming the permission turns a dead end into a sentence somebody can act on.
 *
 * It does not pretend the screen is missing. A 404 for something that exists teaches people
 * that the product is broken rather than that their account is narrow, and this platform's
 * whole business is telling the truth about what it knows.
 */
export function NoAccess({ needs }: { needs: Capability }): ReactElement {
  const info = capabilityInfo(needs);

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="لا تملك صلاحية هذه الشاشة"
        subtitle="حسابك في هذه المنشأة لا يشمل هذه الصلاحية. الصفحة موجودة، والوصول إليها هو ما ينقص."
      />
      <div className="card stack" data-role="no-access" data-needs={needs} style={{ gap: 'var(--s-3)' }}>
        <div className="stack" style={{ gap: 'var(--s-1)' }}>
          <span className="stat-label">الصلاحية المطلوبة</span>
          <strong>{info.nameAr}</strong>
          <p className="muted" style={{ margin: 0 }}>
            {info.summaryAr}
          </p>
        </div>
        <p className="stat-hint" style={{ margin: 0 }}>
          يمنحها مسؤول الحساب في منشأتك من «الإعدادات ← المستخدمون والصلاحيات».
        </p>
        <div className="row" style={{ gap: 'var(--s-3)' }}>
          <Link className="btn btn-secondary" href="/dashboard">
            العودة إلى اللوحة الرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
}
