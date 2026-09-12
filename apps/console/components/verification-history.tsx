import type { ReactElement } from 'react';
import { fieldLabel, formatValue } from './field-card';
import { Panel } from './page-header';

/**
 * The customer's file over time, one verification at a time.
 *
 * A flat list of facts does not answer the question a person opens a profile with: what
 * did the last check tell us that the one before it did not. So the facts are grouped by
 * the verification that produced them.
 *
 * Each field is marked new, changed or confirmed, and confirmed is shown rather than
 * hidden. A field read again and found identical is the most common outcome there is, and
 * a timeline that only shows changes makes a clean re-verification look like nothing
 * happened, which is the opposite of what it means.
 */

export interface VerificationHistoryField {
  fieldPath: string;
  value: unknown;
  kind: 'new' | 'changed' | 'confirmed';
}

export interface VerificationHistoryEntry {
  runId: string;
  reference: string | null;
  productNameAr: string;
  at: Date;
  decision: string | null;
  /** What started it. A monitor sweep and a person pressing a button are not the same
      event, and a file that cannot tell them apart cannot be audited. */
  triggeredBy: string;
  fields: VerificationHistoryField[];
}

const KIND_LABELS: Record<VerificationHistoryField['kind'], string> = {
  new: 'جديد',
  changed: 'تغيّر',
  confirmed: 'مؤكَّد',
};

const TRIGGER_LABELS: Record<string, string> = {
  API: 'عبر الـAPI',
  CONSOLE: 'يدوي من الكونسول',
  MONITOR: 'مراقبة دورية',
  BULK: 'دفعة',
};

const DECISION_LABELS: Record<string, string> = {
  PASS: 'مقبول',
  REVIEW: 'مراجعة',
  FAIL: 'مرفوض',
};

export function VerificationHistory({
  entries,
}: {
  entries: VerificationHistoryEntry[];
}): ReactElement {
  return (
    <Panel
      title="سجل التحققات"
      aside={`${entries.length} عملية`}
      role="verification-history"
      note="كل تحقق يضيف ولا يمحو. القيم السابقة محفوظة، وتظهر داخل كل حقل."
    >
      {entries.length === 0 ? (
        <p className="panel-body empty" data-role="no-verifications">
          لا عمليات تحقق على هذا العميل بعد.
        </p>
      ) : (
        <ol
          className="panel-body stack"
          data-role="history-entries"
          style={{ gap: 'var(--s-4)', margin: 0, paddingInlineStart: 0 }}
        >
          {entries.map((entry) => {
            const changed = entry.fields.filter((field) => field.kind === 'changed').length;
            return (
              <li
                key={entry.runId}
                data-role="history-entry"
                data-changed={changed > 0 ? 'yes' : 'no'}
                style={{ listStyle: 'none' }}
              >
                <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
                  <bdi dir="ltr" className="mono">
                    {entry.at.toISOString().slice(0, 10)}
                  </bdi>
                  <strong>{entry.productNameAr}</strong>
                  {entry.reference ? (
                    <bdi dir="ltr" className="mono muted">
                      {entry.reference}
                    </bdi>
                  ) : null}
                  <span className="muted" data-role="history-trigger">
                    {TRIGGER_LABELS[entry.triggeredBy] ?? entry.triggeredBy}
                  </span>
                  {entry.decision ? (
                    <span className="badge" data-role="history-decision">
                      {DECISION_LABELS[entry.decision] ?? entry.decision}
                    </span>
                  ) : null}
                  {/* Said out loud on the row, so a file can be scanned for the checks
                      that actually moved something. */}
                  {changed > 0 ? (
                    <span className="badge" data-kind="changed" data-role="history-changed-count">
                      {changed} حقلاً تغيّر
                    </span>
                  ) : null}
                </div>

                <ul
                  className="stack"
                  style={{ gap: '2px', margin: 'var(--s-2) 0 0', paddingInlineStart: 0 }}
                >
                  {entry.fields.map((field) => (
                    <li
                      key={field.fieldPath}
                      className="row muted"
                      data-kind={field.kind}
                      style={{ gap: 'var(--s-3)', listStyle: 'none' }}
                    >
                      <span style={{ minWidth: '10ch' }}>{KIND_LABELS[field.kind]}</span>
                      <span>{fieldLabel(field.fieldPath)}</span>
                      <span>{formatValue(field.value).text}</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
