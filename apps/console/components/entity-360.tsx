import type { ReactElement } from 'react';
import { FieldCard, type ProfileFieldView } from './field-card';
import { ChangeBadge, FreshnessBadge, type FreshnessState } from './freshness';
import { Identifier } from './identifier';
import { Timeline, type TimelineEntryView } from './timeline';
import { Panel } from './page-header';

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
  /**
   * How the score was reached. Never omitted when a score is shown: a number without its
   * working is refused by risk management, and showing one without the other on screen
   * would put the analyst in the same position.
   */
  scoreBreakdown: { fieldPath: string; weight: number; earned: number; freshness: string }[];
  completeness: number;
}

export interface RelationView {
  relType: string;
  otherEntityId: string;
  otherName: string | null;
  direction: 'from' | 'to';
  /** How many entities that counterparty is linked to across this tenant. */
  linkedCount: number;
}

const RELATION_LABELS: Record<string, string> = {
  MANAGES: 'يدير',
  OWNS: 'يملك',
  HOLDS_ACCOUNT: 'صاحب الحساب',
  OWNS_PROPERTY: 'يملك العقار',
  SHARES_ADDRESS: 'يشارك العنوان',
};

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
  relations?: RelationView[];
  now?: Date;
}

export function Entity360({
  header,
  fields,
  changes,
  timeline,
  relations = [],
  now,
}: Entity360Props): ReactElement {
  const expired = fields.filter((field) => field.freshness === 'expired');

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <section className="card stack" data-role="header" style={{ gap: 'var(--s-4)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h1 style={{ margin: 0 }}>{header.displayName ?? 'كيان بلا اسم'}</h1>
          <span className="badge" style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-soft)' }}>
            {header.entityType}
          </span>
        </div>

        <div className="row" style={{ gap: 'var(--s-5)' }}>
          {header.identifiers.map((identifier) => (
            <Identifier
              key={identifier.idType}
              label={identifier.idType}
              value={identifier.masked}
            />
          ))}
        </div>

        {/* Two figures, read together: how much we know, and how good what we know is. */}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div className="stat">
            <span className="stat-label">درجة الثقة</span>
            {header.score === null ? (
              <span className="muted">لم تُحسب بعد</span>
            ) : (
              <strong className="stat-value">
                <bdi dir="ltr" className="mono">
                  {header.score}
                </bdi>
              </strong>
            )}
          </div>
          <div className="stat">
            <span className="stat-label">الاكتمال</span>
            <strong className="stat-value">
              <bdi dir="ltr" className="mono">
                {header.completeness}%
              </bdi>
            </strong>
          </div>
        </div>

        {header.score !== null && header.scoreBreakdown.length > 0 ? (
          <details data-role="score-breakdown">
            <summary className="muted">كيف حُسبت الدرجة</summary>
            <table>
              <thead>
                <tr>
                  <th>الحقل</th>
                  <th>الوزن</th>
                  <th>المحتسب</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {header.scoreBreakdown.map((component) => (
                  <tr key={component.fieldPath}>
                    <td>{component.fieldPath}</td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {component.weight}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr" className="mono">
                        {component.earned}
                      </bdi>
                    </td>
                    <td>
                      <FreshnessBadge state={component.freshness as FreshnessState} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
      </section>

      {/*
        The alert appears only when there is something to say. Two separate reasons, kept
        visually apart: a detected change is a warning, an expired field is not.
      */}
      {changes.length > 0 ? (
        <section
          className="card stack"
          data-role="alert-changes"
          style={{ borderColor: 'var(--changed-line)', background: 'var(--changed-bg)' }}
        >
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
        <section
          className="card stack"
          data-role="alert-expired"
          style={{ borderColor: 'var(--expired-line)', background: 'var(--expired-bg)' }}
        >
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

      {relations.length > 0 ? (
        <Panel title="شبكة العلاقات" aside="داخل هذا المستأجر وحده" role="relations">
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>العلاقة</th>
                <th>الطرف الآخر</th>
                <th>مرتبط بـ</th>
              </tr>
            </thead>
            <tbody>
              {relations.map((relation) => (
                <tr
                  key={`${relation.relType}-${relation.otherEntityId}`}
                  data-signal={relation.linkedCount >= 3 ? 'high' : 'normal'}
                >
                  <td>{RELATION_LABELS[relation.relType] ?? relation.relType}</td>
                  <td>
                    <a href={`/entities/${relation.otherEntityId}`}>
                      {relation.otherName ?? 'بلا اسم'}
                    </a>
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {relation.linkedCount}
                    </bdi>{' '}
                    {relation.linkedCount >= 3 ? (
                      <span
                        className="badge"
                        data-kind="change"
                        style={{
                          color: 'var(--changed-fg)',
                          background: 'var(--changed-bg)',
                          borderColor: 'var(--changed-line)',
                        }}
                      >
                        إشارة شبكة
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="panel-body faint" style={{ paddingBlockStart: 0 }}>
            لا تجميع عبر العملاء، وهو حظر تعاقدي وتقني معاً.
          </p>
        </Panel>
      ) : null}

      <Panel title="الخط الزمني" aside="كل ما عرفناه، بترتيب رصده" role="timeline">
        <div className="panel-body">
          <Timeline entries={timeline} />
        </div>
      </Panel>

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
