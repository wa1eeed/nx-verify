import type { ReactElement } from 'react';
import { FieldCard, type ProfileFieldView } from './field-card';
import { ChangeBadge, FreshnessBadge } from './freshness';
import { Identifier } from './identifier';
import { Timeline, type TimelineEntryView } from './timeline';

/**
 * Entity 360, laid out top to bottom as docs/01-blueprint.md section 5.1 specifies:
 * header, alert, cards, timeline, action.
 *
 * One primary button on the screen and no more. Everything a compliance officer can do
 * here that is not "verify again" is secondary, because a screen with three equal buttons
 * is a screen where the important one gets missed.
 */

export interface EntityHeaderView {
  entityId: string;
  displayName: string | null;
  entityType: string;
  /** Already masked. The console never receives a full identifier (rule 4). */
  identifiers: { idType: string; masked: string }[];
  score: number | null;
  completeness: number;
}

export interface DetectedChange {
  fieldPath: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  detectedAt: Date;
}

export interface Entity360Props {
  header: EntityHeaderView;
  fields: ProfileFieldView[];
  changes: DetectedChange[];
  timeline: TimelineEntryView[];
  now?: Date;
}

export function Entity360({
  header,
  fields,
  changes,
  timeline,
  now,
}: Entity360Props): ReactElement {
  const expired = fields.filter((field) => field.freshness === 'expired');

  return (
    <div className="stack">
      <section className="card stack" data-role="header">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0 }}>{header.displayName ?? 'كيان بلا اسم'}</h1>
          <span className="muted">{header.entityType}</span>
        </div>

        <div className="row" style={{ flexWrap: 'wrap', gap: '16px' }}>
          {header.identifiers.map((identifier) => (
            <Identifier
              key={identifier.idType}
              label={identifier.idType}
              value={identifier.masked}
            />
          ))}
        </div>

        <div className="row" style={{ gap: '24px' }}>
          <span>
            درجة الثقة:{' '}
            {header.score === null ? (
              <span className="muted">لم تُحسب بعد</span>
            ) : (
              <bdi dir="ltr" className="mono">
                {header.score}
              </bdi>
            )}
          </span>
          <span>
            الاكتمال:{' '}
            <bdi dir="ltr" className="mono">
              {header.completeness}%
            </bdi>
          </span>
        </div>
      </section>

      {/*
        The alert appears only when there is something to say. Two separate reasons, kept
        visually apart: a detected change is a warning, an expired field is not.
      */}
      {changes.length > 0 ? (
        <section className="card stack" data-role="alert-changes">
          <strong>تغيّرات مرصودة</strong>
          {changes.map((change) => (
            <div key={change.fieldPath} className="row">
              <ChangeBadge severity={change.severity} />
              <span>{change.fieldPath}</span>
              <span className="muted">
                <bdi dir="ltr" className="mono">
                  {change.detectedAt.toISOString().slice(0, 10)}
                </bdi>
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {expired.length > 0 ? (
        <section className="card stack" data-role="alert-expired">
          <div className="row">
            <FreshnessBadge state="expired" />
            <span>
              {expired.length} حقلاً تجاوز مدة صلاحيته. المعرفة قديمة، ولا يعني ذلك وجود مشكلة.
            </span>
          </div>
        </section>
      ) : null}

      <section className="grid" data-role="fields">
        {fields.map((field) => (
          <FieldCard key={field.fieldPath} field={field} {...(now ? { now } : {})} />
        ))}
      </section>

      <section className="card stack" data-role="timeline">
        <strong>الخط الزمني</strong>
        <Timeline entries={timeline} />
      </section>

      <section className="row" data-role="actions">
        {/* The single primary action on this screen. */}
        <button
          type="submit"
          className="btn-primary"
          formAction={`/entities/${header.entityId}/verify`}
        >
          تحديث التحقق
        </button>
        <a className="btn-secondary" href={`/entities/${header.entityId}/evidence`}>
          ملف الدليل
        </a>
        <a className="btn-secondary" href={`/entities/${header.entityId}/monitor`}>
          تفعيل المراقبة
        </a>
      </section>
    </div>
  );
}
