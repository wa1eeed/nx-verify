import type { ReactElement } from 'react';
import { Card } from './ui/card';
import { Ltr } from './ui/ltr';
import { EmptyState } from './page-header';
import { dateAr, timeOfDay } from './format';

/**
 * What the data sources have called us about (ADR-152).
 *
 * `listInboundEvents` had no caller. Provider callbacks are recorded and swept and nothing
 * showed them, and they are the first thing anybody asks for when a verification is stuck
 * waiting for an answer that may or may not have arrived.
 *
 * The provider is named here because this is the panel, not a subscriber's screen: rule 5
 * hides a source name in public responses, and staff diagnosing a stuck run need it.
 */

export interface CallbackRowView {
  id: string;
  provider: string;
  environment: string;
  eventType: string;
  externalId: string;
  status: string;
  receivedAt: Date;
}

const STATUS_LABELS: Record<string, string> = {
  accepted: 'قُبل',
  duplicate: 'مكرر، أُهمل',
  rejected: 'رُفض توقيعه',
  unmatched: 'لا تشغيل ينتظره',
};

export function callbackStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function OperatorCallbacks({ rows }: { rows: CallbackRowView[] }): ReactElement {
  return (
    <Card role="callbacks" labelledBy="callbacks-title">
      <h2 className="card-title admin-card-title" id="callbacks-title">
        النداءات الواردة
      </h2>
      <p className="admin-card-note">
        ما نادتنا به المصادر: آخر ما وصل، وهل قُبل. رفضُ توقيع هنا يعني سرّ ربط لا يطابق، وتكرارٌ
        يعني أن المصدر أعاد الإرسال ولم نحتسبه مرتين.
      </p>

      {rows.length === 0 ? (
        <EmptyState>لا نداءات واردة بعد.</EmptyState>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>متى</th>
                <th>المصدر</th>
                <th>البيئة</th>
                <th>الحدث</th>
                <th>مرجع المصدر</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-role="callback-row" data-status={row.status}>
                  <td>
                    <Ltr>{dateAr(row.receivedAt)}</Ltr>
                    <div className="faint">
                      <Ltr>{timeOfDay(row.receivedAt)}</Ltr>
                    </div>
                  </td>
                  <td>{row.provider}</td>
                  <td>{row.environment === 'sandbox' ? 'اختبار' : 'إنتاج'}</td>
                  <td>
                    <Ltr>{row.eventType}</Ltr>
                  </td>
                  <td>
                    <Ltr>{row.externalId}</Ltr>
                  </td>
                  <td>{callbackStatusLabel(row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
