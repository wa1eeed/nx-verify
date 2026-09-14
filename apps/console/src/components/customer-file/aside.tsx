import type { ReactElement } from 'react';
import type { Assessment, CustomerFile } from '@nx-verify/core';
import { dateAr, timeOfDay } from '../format';
import { Card, CardTitle } from '../ui/card';
import { Icon } from '../ui/icon';
import { Ltr } from '../ui/ltr';
import { RelationGraph } from './graph';

/**
 * The column beside the sections (README, screen 03): what is established, why the risk is
 * what it is, what the file is linked to, and what was verified when.
 */

export interface TimelineField {
  fieldPath: string;
  labelAr: string;
  valueAr: string;
  change: 'new' | 'changed' | 'confirmed';
}

export interface TimelineEntry {
  key: string;
  titleAr: string;
  /** The dot: a verification that completed, one that failed, or anything else. */
  tone: 'done' | 'failed' | 'neutral';
  at: Date;
  reference: string | null;
  /** What started it, in words: a person, the API, a monitor sweep (ADR-106). */
  triggerAr: string | null;
  fields: TimelineField[];
}

const CHANGE_WORDS: Readonly<Record<TimelineField['change'], string>> = {
  new: 'جديد',
  changed: 'تغيّر',
  confirmed: 'مؤكَّد',
};

export function IndicatorsCard({ assessment }: { assessment: Assessment }): ReactElement {
  const items = assessment.items.filter((item) => item.state !== 'NA');
  return (
    <Card label={`مؤشرات ${assessment.mode}`} role="indicators">
      <CardTitle>مؤشرات {assessment.mode}</CardTitle>
      <ul className="kyb-list">
        {items.map((item) => (
          <li key={item.key} className="kyb-item" data-state={item.state} data-indicator={item.key}>
            <span className="kyb-mark" data-state={item.state} aria-hidden="true">
              <Icon
                name={
                  item.state === 'PASS'
                    ? 'check'
                    : item.state === 'FAIL' || item.state === 'WARN'
                      ? 'alert-triangle'
                      : 'clock'
                }
                size={13}
              />
            </span>
            <span className="kyb-text">
              <span>{item.labelAr}</span>
              {item.detailAr ? <span className="kyb-detail">{item.detailAr}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function RiskCard({ file }: { file: CustomerFile }): ReactElement {
  const { assessment } = file;
  return (
    <Card id="risk" tone="accent" label="أسباب درجة المخاطر" role="risk">
      <CardTitle>أسباب درجة المخاطر</CardTitle>
      <p className="card-line" data-role="risk-score">
        {assessment.riskScore === null ? (
          assessment.riskLabelAr
        ) : (
          <>
            {assessment.riskLabelAr} · <Ltr>{assessment.riskScore}</Ltr> من <Ltr>100</Ltr>
          </>
        )}
      </p>
      {assessment.riskScore === null ? (
        <p className="card-line">
          تُقدَّر الدرجة بعد التحقق من{' '}
          {file.entityType === 'FREELANCER' ? 'الوثيقة' : 'السجل التجاري'}.
        </p>
      ) : assessment.riskReasons.length === 0 ? (
        <p className="card-line">لا أسباب ترفع الدرجة فيما تحققنا منه.</p>
      ) : (
        <ul className="reason-list" data-role="risk-reasons">
          {assessment.riskReasons.map((reason, index) => (
            <li key={`${reason.key}-${index}`} className="reason-box" data-reason={reason.key}>
              <strong className="reason-weight">
                <Ltr>+{reason.weight}</Ltr>
              </strong>{' '}
              {reason.textAr}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function IntersectionsCard({ file }: { file: CustomerFile }): ReactElement {
  return (
    <Card id="intersections" label="التقاطعات المكتشفة" role="intersections">
      <CardTitle>التقاطعات المكتشفة</CardTitle>
      <p className="card-line">علاقات مع كيانات تحقق منها سابقاً</p>
      <RelationGraph file={file} />
      {file.intersections.length === 0 ? (
        <p className="card-line">
          لم نجد مديراً أو شريكاً أو حساباً أو عنواناً مشتركاً مع عملائك الآخرين.
        </p>
      ) : (
        <ul className="reason-list">
          {file.intersections.map((intersection, index) => (
            <li
              key={`${intersection.kind}-${index}`}
              className="reason-box"
              data-kind={intersection.kind}
            >
              <span>{intersection.textAr}</span>
              <span className="reason-links">
                {intersection.entities.map((entity, position) => (
                  <span key={entity.entityId}>
                    {position > 0 ? '، ' : ''}
                    <a href={`/customers/${entity.entityId}`}>{entity.name ?? 'بلا اسم'}</a>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="card-foot">
        تُبحث الروابط بين عملائك وحدهم، ولا تُقارن بيانات مشترك بمشترك آخر.
      </p>
    </Card>
  );
}

/** How many of the latest entries show before the rest fold away. */
const TIMELINE_VISIBLE = 5;

function TimelineItem({ entry }: { entry: TimelineEntry }): ReactElement {
  return (
    <li className="timeline-item" data-tone={entry.tone}>
      <span className="timeline-dot" aria-hidden="true" />
      <div className="timeline-body">
        <span className="timeline-title">{entry.titleAr}</span>
        <span className="timeline-time">
          {dateAr(entry.at)} · <Ltr>{timeOfDay(entry.at)}</Ltr>
          {entry.triggerAr ? ` · ${entry.triggerAr}` : null}
          {entry.reference ? (
            <>
              {' '}
              · <Ltr>{entry.reference}</Ltr>
            </>
          ) : null}
        </span>
        {entry.fields.length > 0 ? (
          <details className="file-details">
            <summary>ما سجّله ({entry.fields.length})</summary>
            <ul>
              {entry.fields.map((field) => (
                <li key={field.fieldPath} data-change={field.change}>
                  <span className="timeline-change">{CHANGE_WORDS[field.change]}</span>{' '}
                  {field.labelAr}: {field.valueAr}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The latest verifications, and the day the file was opened at the end. Older ones fold
 * away rather than disappear: the record is kept in full, and a long one should not push the
 * rest of the column off the screen.
 */
export function TimelineCard({ entries }: { entries: TimelineEntry[] }): ReactElement {
  const opening = entries.filter((entry) => entry.key === 'created');
  const runs = entries.filter((entry) => entry.key !== 'created');
  const recent = runs.slice(0, TIMELINE_VISIBLE);
  const older = runs.slice(TIMELINE_VISIBLE);
  return (
    <Card label="سجل التحقق" role="verification-history">
      <CardTitle>سجل التحقق</CardTitle>
      <ol className="timeline">
        {recent.map((entry) => (
          <TimelineItem key={entry.key} entry={entry} />
        ))}
      </ol>
      {older.length > 0 ? (
        <details className="file-details timeline-older">
          <summary>عمليات أقدم ({older.length})</summary>
          <ol className="timeline">
            {older.map((entry) => (
              <TimelineItem key={entry.key} entry={entry} />
            ))}
          </ol>
        </details>
      ) : null}
      <ol className="timeline">
        {opening.map((entry) => (
          <TimelineItem key={entry.key} entry={entry} />
        ))}
      </ol>
    </Card>
  );
}
