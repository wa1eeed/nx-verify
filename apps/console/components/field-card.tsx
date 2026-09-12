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
    </article>
  );
}
