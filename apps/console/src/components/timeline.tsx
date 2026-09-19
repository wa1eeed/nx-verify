import type { ReactElement } from 'react';
import { fieldLabel, formatValue } from './field-card';
import { Ltr, Table, Tag, Th } from './ui';

/**
 * The entity timeline.
 *
 * It shows attestations, which are the only facts that exist, and each line names what
 * triggered it. That column is what turns "the data changed" into "the monitor found it
 * on the fourth", which is the question an auditor actually asks.
 *
 * A row is never edited and never removed, so a line that has been replaced stays here
 * and says so. That is the whole argument for writing facts this way, and it is only an
 * argument if somebody can read it.
 */

export type TriggeredBy = 'API' | 'CONSOLE' | 'MONITOR' | 'BULK';

const TRIGGER_LABELS: Record<TriggeredBy, string> = {
  API: 'عبر الـAPI',
  CONSOLE: 'يدوي من الكونسول',
  MONITOR: 'من المراقبة',
  BULK: 'ضمن دفعة',
};

export function triggerLabel(triggeredBy: TriggeredBy | string | null): string {
  if (triggeredBy === null) {
    // The verification behind a fact can be aged out by retention long before the fact is.
    // Saying so is better than a blank, and far better than guessing.
    return 'لم يعد معروفاً';
  }
  return TRIGGER_LABELS[triggeredBy as TriggeredBy] ?? triggeredBy;
}

export interface TimelineEntryView {
  attestationId: string;
  fieldPath: string;
  value: unknown;
  authority: string;
  observedAt: Date;
  triggeredBy: TriggeredBy | string | null;
  /** True when this row differs from the one it superseded. */
  changed: boolean;
  /** The number of the verification that recorded it, where the caller read it. */
  runReference?: string | null | undefined;
  /** False once a later verification has replaced this row. */
  current?: boolean | undefined;
  /** When the authority's own validity ends, where it states one. */
  validUntil?: Date | null | undefined;
}

export function Timeline({ entries }: { entries: TimelineEntryView[] }): ReactElement {
  if (entries.length === 0) {
    return <p className="muted">لا توجد إفادات بعد.</p>;
  }

  return (
    <Table label="سجل الإفادات" caption="كل ما سُجّل، الأحدث أولاً">
      <thead>
        <tr>
          <Th>التاريخ</Th>
          <Th>الحقل</Th>
          <Th>القيمة</Th>
          <Th>المصدر</Th>
          <Th>مصدر الإطلاق</Th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.attestationId} data-changed={entry.changed ? 'true' : 'false'}>
            <td>
              <bdi dir="ltr" className="mono">
                {entry.observedAt.toISOString().slice(0, 16).replace('T', ' ')}
              </bdi>
              {entry.validUntil ? (
                <span className="faint" data-role="valid-until">
                  {' '}
                  سارية حتى <Ltr>{entry.validUntil.toISOString().slice(0, 10)}</Ltr>
                </span>
              ) : null}
            </td>
            <td>{fieldLabel(entry.fieldPath)}</td>
            <td>
              {formatValue(entry.value, entry.fieldPath).text}{' '}
              {entry.changed ? (
                <Tag tone="accent" role="timeline-changed">
                  تغيّرت هنا
                </Tag>
              ) : null}{' '}
              {entry.current === false ? (
                <span className="faint" data-role="superseded">
                  استُبدلت لاحقاً
                </span>
              ) : null}
            </td>
            <td>{entry.authority}</td>
            <td className="muted">
              {triggerLabel(entry.triggeredBy)}
              {entry.runReference ? (
                <>
                  {' · '}
                  <Ltr>{entry.runReference}</Ltr>
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
