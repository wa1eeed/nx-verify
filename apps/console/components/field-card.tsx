import { fieldLabelAr } from '@nx-verify/core';
import type { ReactElement } from 'react';
import { FreshnessBadge, type FreshnessState } from './freshness';
import { Identifier } from './identifier';

/**
 * One field, one card.
 *
 * Rule 6 shows up here as a hard constraint on the component itself: a field cannot be
 * rendered without its authority and its observed_at, because the props require them.
 * There is deliberately no optional path that draws a value on its own, so a screen that
 * forgets provenance fails to compile rather than shipping.
 */

export interface ProfileFieldView {
  fieldPath: string;
  value: unknown;
  /** The official body. Never the provider (rule 5). */
  authority: string;
  observedAt: Date;
  effectiveUntil: Date | null;
  freshness: FreshnessState;
  confidence: number;
  /**
   * Everything this field held before, newest first, without the value in force.
   *
   * Present only where the caller loaded it. A field with no history behind it is a field
   * verified once, which is different from a field whose history we did not fetch, and
   * the card says which by showing the row count rather than an empty drawer.
   */
  history?: FieldHistoryView[];
}

export interface FieldHistoryView {
  value: unknown;
  authority: string | null;
  observedAt: Date;
  /** True when this value differed from the one before it. */
  changed: boolean;
}


/**
 * One table of labels, in the domain.
 *
 * Two copies drift within a month, and the drift shows as a field labelled one way on
 * screen and another way on the document the customer hands to their auditor.
 */
export function fieldLabel(fieldPath: string): string {
  return fieldLabelAr(fieldPath);
}

export function formatValue(value: unknown): { text: string; numeric: boolean } {
  if (value === null || value === undefined) {
    return { text: 'غير متوفر', numeric: false };
  }
  if (typeof value === 'number') {
    return { text: String(value), numeric: true };
  }
  if (typeof value === 'boolean') {
    return { text: value ? 'نعم' : 'لا', numeric: false };
  }
  if (typeof value === 'string') {
    return { text: value, numeric: /^[\w\-+.:/]+$/.test(value) };
  }
  return { text: JSON.stringify(value), numeric: false };
}

/**
 * Rounds down, never up.
 *
 * A field with seven and a half days left has seven, not eight. Telling a compliance
 * officer they have more time than they do is the one error this number must not make.
 */
export function daysUntil(date: Date | null, now = new Date()): number | null {
  if (date === null) {
    return null;
  }
  return Math.floor((date.getTime() - now.getTime()) / 86_400_000);
}

export function FieldCard({ field, now }: { field: ProfileFieldView; now?: Date }): ReactElement {
  const formatted = formatValue(field.value);
  const remaining = daysUntil(field.effectiveUntil, now);

  return (
    <article className="card stack" data-field={field.fieldPath}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{fieldLabel(field.fieldPath)}</strong>
        <FreshnessBadge state={field.freshness} />
      </div>

      <div style={{ fontSize: '18px' }}>
        {formatted.numeric ? <Identifier value={formatted.text} /> : formatted.text}
      </div>

      {/* Rule 6. No field is displayed without its source and its timestamp. */}
      <div className="muted stack" style={{ gap: '2px' }}>
        <span data-role="authority">المصدر: {field.authority}</span>
        <span data-role="observed-at">
          آخر تحقق:{' '}
          <bdi dir="ltr" className="mono">
            {field.observedAt.toISOString().slice(0, 10)}
          </bdi>
        </span>
        {remaining === null ? (
          <span data-role="remaining">لا تنتهي صلاحيته</span>
        ) : (
          <span data-role="remaining">
            {remaining >= 0
              ? `المتبقي: ${remaining} يوماً`
              : `انتهت منذ ${Math.abs(remaining)} يوماً`}
          </span>
        )}
        {field.confidence < 1 ? (
          <span data-role="confidence">درجة الثقة في المطابقة: {field.confidence}</span>
        ) : null}
      </div>

      {/*
        What this field said before.
        
        A verification never overwrites the previous one: it adds a fact and marks the old
        one replaced. That has always been true in the database and was visible nowhere,
        so a customer reading a profile had no way to tell a value that has held for a
        year from one that changed last week.
        
        A details element rather than a script, so it prints, survives a refresh, and
        works with the keyboard alone.
      */}
      {field.history && field.history.length > 0 ? (
        <details data-role="field-history">
          <summary className="muted">
            القيم السابقة (
            <bdi dir="ltr" className="mono">
              {field.history.length}
            </bdi>
            )
          </summary>
          <ul className="stack" style={{ gap: 'var(--s-2)', margin: 0, paddingInlineStart: 0 }}>
            {field.history.map((entry, index) => {
              const previous = formatValue(entry.value);
              return (
                <li
                  key={`${entry.observedAt.toISOString()}-${index}`}
                  className="row"
                  data-changed={entry.changed ? 'yes' : 'no'}
                  style={{ gap: 'var(--s-3)', listStyle: 'none' }}
                >
                  <bdi dir="ltr" className="mono">
                    {entry.observedAt.toISOString().slice(0, 10)}
                  </bdi>
                  <span>{previous.text}</span>
                  {entry.changed ? (
                    <span className="badge" data-kind="changed" data-role="history-changed">
                      تغيّر هنا
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
