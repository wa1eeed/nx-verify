import type { ReactElement } from 'react';
import { fieldLabel, formatValue } from './field-card';

/**
 * The entity timeline.
 *
 * It shows attestations, which are the only facts that exist, and each line names what
 * triggered it. That column is what turns "the data changed" into "the monitor found it
 * on the fourth", which is the question an auditor actually asks.
 */

export type TriggeredBy = 'API' | 'CONSOLE' | 'MONITOR' | 'BULK';

const TRIGGER_LABELS: Record<TriggeredBy, string> = {
  API: 'عبر الـAPI',
  CONSOLE: 'يدوي من الكونسول',
  MONITOR: 'من المراقبة',
  BULK: 'ضمن دفعة',
};

export interface TimelineEntryView {
  attestationId: string;
  fieldPath: string;
  value: unknown;
  authority: string;
  observedAt: Date;
  triggeredBy: TriggeredBy;
  /** True when this row differs from the one it superseded. */
  changed: boolean;
}

export function Timeline({ entries }: { entries: TimelineEntryView[] }): ReactElement {
  if (entries.length === 0) {
    return <p className="muted">لا توجد إفادات بعد.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>التاريخ</th>
          <th>الحقل</th>
          <th>القيمة</th>
          <th>المصدر</th>
          <th>مصدر الإطلاق</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.attestationId} data-changed={entry.changed ? 'true' : 'false'}>
            <td>
              <bdi dir="ltr" className="mono">
                {entry.observedAt.toISOString().slice(0, 16).replace('T', ' ')}
              </bdi>
            </td>
            <td>{fieldLabel(entry.fieldPath)}</td>
            <td>{formatValue(entry.value).text}</td>
            <td>{entry.authority}</td>
            <td className="muted">{TRIGGER_LABELS[entry.triggeredBy]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
