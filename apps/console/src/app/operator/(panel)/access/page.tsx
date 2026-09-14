import type { ReactElement } from 'react';
import { listOperatorChanges } from '@nx-verify/providers';
import { PageHeader } from '../../../../components/page-header';
import { Card, CardTitle, Ltr, Table, Th } from '../../../../components/ui';
import { EmptyState } from '../../../../components/page-header';
import { OPERATOR_SESSION_HOURS, operatorQuery, requireOperator } from '../../../../lib/operator';

/** Never prerendered, and refuses to render without an operator sign in. */
export const dynamic = 'force-dynamic';

/**
 * Who may enter the panel, and what staff changed (handoff screen 00, «الصلاحيات والتدقيق»).
 *
 * The log reads operator_audit, which holds references and field names and never material
 * (ADR-109), so nothing on this screen is a secret even when it names where one is kept.
 */

const ACTION_LABELS: Readonly<Record<string, string>> = {
  'connection.set': 'ضبط الربط مع مصدر البيانات',
  'connection.tested': 'اختبار الاتصال',
  'credentials.saved': 'حفظ بيانات الربط',
};

const WHEN = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Riyadh',
});

export default async function OperatorAccessPage(): Promise<ReactElement> {
  await requireOperator();
  const changes = await operatorQuery((db) => listOperatorChanges(db, null, 200));

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="الصلاحيات والتدقيق"
        subtitle="كل تغيير أجراه فريق الإدارة: ما الذي تغيّر، ومن غيّره، ومتى."
      />

      <Card label="الدخول إلى اللوحة">
        <CardTitle>الدخول إلى اللوحة</CardTitle>
        <p style={{ margin: 0 }}>
          الدخول برمز إدارة مضبوط في النشر، والجلسة تنتهي بعد <Ltr>{OPERATOR_SESSION_HOURS}</Ltr>{' '}
          ساعات.
        </p>
      </Card>

      <Card label="سجل التغييرات">
        <CardTitle>سجل التغييرات</CardTitle>
        {changes.length === 0 ? (
          <EmptyState>لم يُجرِ أحد أي تغيير بعد.</EmptyState>
        ) : (
          <Table label="سجل التغييرات">
            <thead>
              <tr>
                <Th>الوقت</Th>
                <Th>الموظف</Th>
                <Th>الإجراء</Th>
                <Th>ما تغيّر</Th>
                <Th>الحقول</Th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change, index) => (
                <tr key={`${change.at.toISOString()}-${index}`} data-role="audit-row">
                  <td>
                    <Ltr>{WHEN.format(change.at)}</Ltr>
                  </td>
                  <td>
                    <Ltr>{change.operatorId}</Ltr>
                  </td>
                  <td>{ACTION_LABELS[change.action] ?? <Ltr>{change.action}</Ltr>}</td>
                  <td>
                    <Ltr>{change.target}</Ltr>
                  </td>
                  <td>
                    <Ltr>{Object.keys(change.metadata).join(', ') || '·'}</Ltr>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
