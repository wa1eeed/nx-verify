import type { ReactElement } from 'react';
import { fieldLabel } from './field-card';
import { PageHeader } from './page-header';

/**
 * The retention settings screen.
 *
 * Three things this screen must say out loud, from docs/01-blueprint.md section 6.1:
 *
 *   Where each value came from, so an operator can tell what they changed from what they
 *   inherited, and put it back.
 *
 *   That editing a duration rewrites no fact. It recomputes. People assume an edit like
 *   this is destructive, and the sentence is cheaper than the support ticket.
 *
 *   What the change will do before it is saved. "340 entities move to expired" is the
 *   difference between an informed decision and an alert storm on Monday.
 */

export interface PolicyRowView {
  fieldPath: string;
  ttlDays: number;
  weight: number;
  source: 'system' | 'tenant';
}

export interface ImpactPreview {
  fieldPath: string;
  proposedTtlDays: number;
  newlyExpired: number;
}

export function FreshnessSettings({
  rows,
  preview,
}: {
  rows: PolicyRowView[];
  preview?: ImpactPreview | undefined;
}): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="مدد الصلاحية"
        subtitle="كم تبقى المعرفة صالحة قبل أن تُطلب من جديد، حقلاً حقلاً."
      />

      <p className="card muted" data-role="inert-notice">
        تعديل المدة لا يغيّر أي إفادة سابقة. تُعاد الحسابات فقط، والحقائق تبقى كما سُجّلت.
      </p>

      {preview ? (
        <section className="card stack" data-role="impact-preview">
          <strong>معاينة الأثر قبل الحفظ</strong>
          <p>
            تغيير {fieldLabel(preview.fieldPath)} إلى{' '}
            <bdi dir="ltr" className="mono">
              {preview.proposedTtlDays}
            </bdi>{' '}
            يوماً سينقل{' '}
            <bdi dir="ltr" className="mono">
              {preview.newlyExpired}
            </bdi>{' '}
            كياناً إلى حالة منتهي الصلاحية.
          </p>
        </section>
      ) : null}

      <section className="card">
        <table>
          <thead>
            <tr>
              <th>المعلومة</th>
              <th>المدة بالأيام</th>
              <th>الوزن في الدرجة</th>
              <th>المصدر</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.fieldPath} data-source={row.source}>
                <td>{fieldLabel(row.fieldPath)}</td>
                <td>
                  <bdi dir="ltr" className="mono">
                    {row.ttlDays}
                  </bdi>
                </td>
                <td>
                  {/* The weight moves with the duration. A duration without a weight has
                      no meaning in the confidence score. */}
                  <bdi dir="ltr" className="mono">
                    {row.weight}
                  </bdi>
                </td>
                <td className="muted">
                  {row.source === 'system' ? 'افتراضي النظام' : 'معدّل من المشترك'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="row">
        <button type="submit" className="btn-primary">
          حفظ المدد
        </button>
        <button type="button" className="btn-secondary">
          العودة إلى الافتراضي
        </button>
      </div>
    </div>
  );
}
